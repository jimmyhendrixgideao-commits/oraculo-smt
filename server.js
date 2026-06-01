// ═══════════════════════════════════════════════════════════════════════════════
//  ORÁCULO SMT v2.0 — Servidor Unificado (Reconstrução Limpa)
//  Criado por Jimmy Hendrix Queiroz
//  Sistema Inteligente de Suporte Técnico para Indústria SMT
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. DEPENDÊNCIAS & CONFIGURAÇÃO ──────────────────────────────────────────
try { require('dotenv').config(); } catch {}

const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const fetch      = require('node-fetch');
const cors       = require('cors');
const { v4: uuidv4 } = require('uuid');
const { execSync }   = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;
const SERVER_GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const SERVER_CLAUDE_KEY = process.env.CLAUDE_API_KEY || '';

// ── 2. SEGURANÇA SILENCIOSA ─────────────────────────────────────────────────
let helmet, rateLimit, xss;
try { helmet = require('helmet'); } catch { helmet = null; }
try { rateLimit = require('express-rate-limit'); } catch { rateLimit = null; }
try { xss = require('xss'); } catch { xss = null; }

if (helmet) { app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })); }
if (rateLimit) {
  app.use('/api/query',  rateLimit({ windowMs: 60000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Limite de 15 consultas/min atingido. Aguarde.' } }));
  app.use('/api/upload', rateLimit({ windowMs: 3600000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Limite de uploads/hora atingido.' } }));
}

function sanitize(s) {
  if (typeof s !== 'string') return s;
  if (xss) return xss(s.trim(), { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script','style'] });
  return s.trim().replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/paginas', express.static(path.join(__dirname, 'paginas')));

// ── 3. PASTAS & BANCO DE DADOS ──────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR    = path.join(__dirname, 'data');
const PAGINAS_DIR = path.join(__dirname, 'paginas');
const DB_FILE     = path.join(DATA_DIR, 'knowledge.json');
const CACHE_FILE  = path.join(DATA_DIR, 'cache.json');
const KB_FILE     = path.join(__dirname, 'smt-knowledge-base.json');
[UPLOADS_DIR, DATA_DIR, PAGINAS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function loadDB()    { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { manuals: [], experiences: [] }; } }
function saveDB(db)  { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return { entries: [] }; } }
function saveCache(c){ if (c.entries.length > 500) { c.entries.sort((a,b)=>(b.hits||1)-(a.hits||1)); c.entries = c.entries.slice(0,500); } fs.writeFileSync(CACHE_FILE, JSON.stringify(c,null,2)); }

// ── BANCO DE CONHECIMENTO SMT LOCAL ─────────────────────────────────────────
let SMT_KB = null;
function loadKnowledgeBase() {
  try {
    if (fs.existsSync(KB_FILE)) {
      SMT_KB = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
      const errCount = Object.values(SMT_KB.error_codes||{}).reduce((s,a)=>s+a.length,0);
      const procCount = Object.values(SMT_KB.procedures||{}).reduce((s,a)=>s+a.length,0);
      const troubleCount = Object.keys(SMT_KB.troubleshooting||{}).length;
      console.log(`📘 Base SMT carregada: ${errCount} erros, ${procCount} procedimentos, ${troubleCount} troubleshooting, ${Object.keys(SMT_KB.glossary||{}).length} termos`);
    }
  } catch(e) { console.warn('KB erro:', e.message); }
}

// Busca no banco local por relevância
function searchKB(question) {
  if (!SMT_KB) return '';
  const ql = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let kbContext = '';

  // 1. Busca por código de erro exato
  const errorMatch = question.match(/[Ee]\d{3,5}|[A-Z]{2,}\d{3,}/);
  if (errorMatch) {
    const code = errorMatch[0].toUpperCase();
    for (const [brand, errors] of Object.entries(SMT_KB.error_codes||{})) {
      const found = errors.find(e => e.code.toUpperCase() === code);
      if (found) {
        kbContext += `\n[KB LOCAL - ERRO] ${found.code}: ${found.desc}\nCausa: ${found.cause}\nSolução: ${found.solution}\nNível: ${found.level}\n`;
      }
    }
  }

  // 2. Busca por troubleshooting (problemas comuns)
  const troubleKW = {
    tombstone: ['tombstone','componente em pe','em pé','drawbridge'],
    solder_bridge: ['bridge','ponte de solda','curto','short'],
    cold_solder: ['solda fria','cold solder','fosca','cold joint'],
    missing_component: ['componente faltando','missing','ausente','sem componente','não colou'],
    offset_placement: ['offset','fora de posição','deslocado','desvio','misaligned']
  };
  for (const [key, keywords] of Object.entries(troubleKW)) {
    if (keywords.some(kw => ql.includes(kw)) && SMT_KB.troubleshooting?.[key]) {
      const t = SMT_KB.troubleshooting[key];
      kbContext += `\n[KB LOCAL - TROUBLESHOOTING] ${t.symptom}\n`;
      t.causes.forEach(c => { kbContext += `  Causa (${c.prob}%): ${c.cause} → ${c.fix}\n`; });
    }
  }

  // 3. Busca por procedimentos
  const procKW = {
    calibration: ['calibra','calibration','reset','teaching','offset','zero return','mt reset'],
    maintenance: ['manutencao','maintenance','limpar','lubrificar','preventiva','inspecao','trocar filtro']
  };
  for (const [cat, keywords] of Object.entries(procKW)) {
    if (keywords.some(kw => ql.includes(kw)) && SMT_KB.procedures?.[cat]) {
      for (const proc of SMT_KB.procedures[cat]) {
        const procWords = (proc.name + ' ' + (proc.machine||'')).toLowerCase();
        if (keywords.some(kw => ql.includes(kw) && (procWords.includes(kw) || ql.includes(proc.name.toLowerCase().substring(0,10))))) {
          kbContext += `\n[KB LOCAL - PROCEDIMENTO] ${proc.name} (${proc.machine})\n`;
          if (proc.steps) proc.steps.forEach(s => { kbContext += `  ${s}\n`; });
          if (proc.tasks) proc.tasks.forEach(t => { kbContext += `  • ${t}\n`; });
          if (proc.time) kbContext += `  Tempo: ${proc.time}\n`;
          if (proc.frequency) kbContext += `  Frequência: ${proc.frequency}\n`;
        }
      }
    }
  }

  // 4. Busca por especificações
  const specKW = {
    solder_paste: ['pasta','paste','stencil','squeegee','impressao'],
    reflow_leadfree: ['reflow','lead free','lead-free','perfil','profile','temperatura'],
    vacuum: ['vacuo','vacuum','pressao','pressão','kpa','mpa'],
    placement_accuracy: ['precisao','accuracy','tolerancia','offset']
  };
  for (const [key, keywords] of Object.entries(specKW)) {
    if (keywords.some(kw => ql.includes(kw)) && SMT_KB.specifications?.[key]) {
      const spec = SMT_KB.specifications[key];
      kbContext += `\n[KB LOCAL - ESPECIFICAÇÕES] ${key.replace(/_/g,' ').toUpperCase()}\n`;
      for (const [k,v] of Object.entries(spec)) { kbContext += `  ${k}: ${v}\n`; }
    }
  }

  // 5. Glossário
  const glossaryTerms = Object.keys(SMT_KB.glossary||{});
  const matchedTerms = glossaryTerms.filter(t => ql.includes(t.toLowerCase()));
  if (matchedTerms.length) {
    kbContext += `\n[KB LOCAL - GLOSSÁRIO]\n`;
    matchedTerms.forEach(t => { kbContext += `  ${t}: ${SMT_KB.glossary[t]}\n`; });
  }

  if (kbContext) console.log(`📘 KB local: ${kbContext.split('\n').length} linhas de contexto encontradas`);
  return kbContext;
}

// ── 4. CACHE INTELIGENTE (Jaccard) ──────────────────────────────────────────
const STOPWORDS = new Set(['o','a','os','as','um','uma','de','do','da','dos','das','e','ou','para','por','com','em','no','na','nos','nas','que','se','como','qual','the','of','for','in','on','at','to','is','are','how','what','this','that']);
function tokenize(t) { return (t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w)); }
function similarity(a,b) { const tA=new Set(tokenize(a)),tB=new Set(tokenize(b)); if(!tA.size||!tB.size)return 0; let i=0; for(const t of tA)if(tB.has(t))i++; return i/(tA.size+tB.size-i); }
function findInCache(q,mIds) { const c=loadCache(),k=(mIds||[]).sort().join(','); let best=null,bs=0; for(const e of c.entries){const ek=(e.manualIds||[]).sort().join(',');if(k&&ek&&k!==ek)continue;const s=similarity(q,e.question);if(s>=0.65&&s>bs){bs=s;best=e;}} return best?{...best,score:bs}:null; }
function addToCache(q,a,p,m,mode) { const c=loadCache(); c.entries.push({id:uuidv4(),question:q,answer:a,referencedPages:p||[],manualIds:m||[],mode:mode||'gemini',createdAt:new Date().toISOString(),hits:1}); saveCache(c); }
function bumpCacheHit(id) { const c=loadCache(); const e=c.entries.find(x=>x.id===id); if(e){e.hits=(e.hits||1)+1;e.lastUsedAt=new Date().toISOString();saveCache(c);} }

// ── 5. EXTRAÇÃO DE CONTEÚDO + OCR ──────────────────────────────────────────
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') { try { const p=require('pdf-parse'); const d=await p(fs.readFileSync(filePath)); return {text:d.text,pages:d.numpages,method:'text'}; } catch(e) { return {text:'',pages:0,method:'ocr-needed'}; } }
  if (ext === '.docx' || ext === '.doc') { try { const m=require('mammoth'); const r=await m.extractRawText({path:filePath}); return {text:r.value,pages:null,method:'text'}; } catch { return {text:'',pages:0,method:'error'}; } }
  return { text:'', pages:0, method:'unsupported' };
}

async function runOCR(imgPath) {
  try { const{createWorker}=require('tesseract.js'); const w=await createWorker('eng+por'); const{data:{text}}=await w.recognize(imgPath); await w.terminate(); return text.trim(); } catch { return ''; }
}

async function extractWithOCR(filePath, pageImages) {
  const ext = await extractText(filePath);
  if (ext.text && ext.text.length > 500) return ext;
  if (!pageImages?.length) return ext;
  console.log('📷 Texto insuficiente — OCR em andamento...');
  let ocr = '';
  for (let i = 0; i < Math.min(pageImages.length, 50); i++) {
    const p = path.join(__dirname, pageImages[i].url.replace(/^\//, ''));
    if (fs.existsSync(p)) { const t = await runOCR(p); if (t) ocr += `\n--- Página ${pageImages[i].page} ---\n${t}`; }
  }
  return { text: ocr || ext.text, pages: ext.pages || pageImages.length, method: ocr ? 'ocr' : ext.method };
}

// ── 6. ESTRUTURAÇÃO DE CONTEÚDO ─────────────────────────────────────────────
function structureContent(text) {
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  const sections = []; let cur = { type:'general', title:'', content:[] };
  for (const line of lines) {
    if (/warning|caution|danger|atenção|cuidado|perigo/i.test(line) && line.length < 80) { if(cur.content.length)sections.push({...cur}); cur={type:'warning',title:line,content:[]}; }
    else if (/error|alarm|fault|erro|alarme|falha|E\d{3,5}/i.test(line) && line.length < 60) { if(cur.content.length)sections.push({...cur}); cur={type:'error_code',title:line,content:[]}; }
    else if (/^(\d+\.?\d*\.?\d*\s+[A-Z].{3,60}|[A-Z][A-Z\s]{5,50})$/.test(line)) { if(cur.content.length)sections.push({...cur}); cur={type:'section',title:line,content:[]}; }
    else { cur.content.push(line); }
  }
  if (cur.content.length || cur.title) sections.push(cur);
  return sections.filter(s => s.content.length > 0);
}

// ── 7. RAG — CHUNKING + BM25 + RETRIEVAL ────────────────────────────────────
function chunkText(text, size=600, overlap=150) {
  const words = text.split(/\s+/); const chunks = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    const c = words.slice(i, i + size).join(' ');
    if (c.trim().length > 30) chunks.push(c);
  }
  return chunks;
}

function buildBM25(docs) {
  const tDocs = docs.map(d => tokenize(d));
  const avg = tDocs.reduce((s,d)=>s+d.length,0) / Math.max(tDocs.length,1);
  const df = {};
  for (const d of tDocs) for (const t of new Set(d)) df[t] = (df[t]||0)+1;
  return { tDocs, avg, df, N: tDocs.length };
}

function bm25Score(idx, query) {
  const qt = tokenize(query);
  return idx.tDocs.map((doc,i) => {
    const tf = {}; for(const t of doc) tf[t]=(tf[t]||0)+1;
    let score = 0;
    for (const t of qt) {
      if (!tf[t]) continue;
      const idf = Math.log((idx.N-(idx.df[t]||0)+0.5)/((idx.df[t]||0)+0.5)+1);
      score += idf * (tf[t]*2.5) / (tf[t]+1.5*(1-0.75+0.75*doc.length/idx.avg));
    }
    return { i, score };
  }).sort((a,b) => b.score - a.score);
}

// ── 8. EXPANSÃO SEMÂNTICA SMT ───────────────────────────────────────────────
const SMT_SYN = {
  'transporte':['transport','conveyor','esteira','lane','board transfer','pcb transfer'],
  'motor':['motor','servo','axis','eixo','driver','spindle','mt'],
  'vacuum':['vacuum','vacuo','vácuo','suction','nozzle','pick','bocal'],
  'vision':['vision','camera','visão','fiducial','mark','recognition','vcs'],
  'feeder':['feeder','alimentador','reel','bobina','tape','fita','fc'],
  'calibracao':['calibration','calibracao','offset','teaching','teach','zero return'],
  'nozzle':['nozzle','bocal','bico','suction','pick tip'],
  'alarm':['alarm','alarme','error','erro','fault','falha','warning','code'],
  'placement':['placement','place','posição','offset','deviation','desvio'],
  'solder':['solder','pasta','paste','solda','cream','stencil','print'],
  'board':['board','placa','pcb','panel','painel','substrato'],
  'temperature':['temperature','temperatura','reflow','profile','perfil','thermal'],
  'reset':['reset','reiniciar','initialize','inicializar','restart','zero','home'],
};

function expandQuery(q) {
  const tokens = tokenize(q); const expanded = new Set(tokens);
  for (const t of tokens) {
    for (const [k,syns] of Object.entries(SMT_SYN)) {
      if (t.includes(k)||k.includes(t)||syns.some(s=>s.includes(t)||t.includes(s))) { syns.forEach(s=>expanded.add(s)); expanded.add(k); }
    }
  }
  return [...expanded].join(' ');
}

// RAG Cross-Manual: pontua chunks de TODOS os manuais juntos
function ragCrossManual(manuals, query, topK=10) {
  const allChunks = [];
  for (const m of manuals) {
    if (!m.textPreview) continue;
    chunkText(m.textPreview).forEach(c => allChunks.push({ text:c, manual:m.name, manualId:m.id }));
  }
  if (!allChunks.length) return { chunks:[], hits:{} };
  const idx = buildBM25(allChunks.map(c=>c.text));
  const ranked = bm25Score(idx, expandQuery(query));
  const top = ranked.slice(0, topK).map(r => allChunks[r.i]);
  const hits = {};
  top.forEach(c => { hits[c.manual] = (hits[c.manual]||0)+1; });
  console.log(`📚 RAG: ${allChunks.length} chunks → top ${topK} | Hits: ${JSON.stringify(hits)}`);
  return { chunks: top, hits };
}

// ── 9. AGENTES ESPECIALIZADOS ───────────────────────────────────────────────
function detectAgent(q) {
  const ql = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const agents = {
    error:       { kw:['erro','error','alarme','alarm','fault','falha','codigo','code','parou','travou','nao funciona'], w:0 },
    procedure:   { kw:['como fazer','how to','procedimento','passo a passo','instalar','install','trocar','replace','montar','desmontar','configurar'], w:0 },
    diagnostic:  { kw:['diagnostico','causa','porque','por que','motivo','sintoma','investigar','analisar','identificar'], w:0 },
    maintenance: { kw:['manutencao','maintenance','preventiva','lubrificar','limpar','inspecao','consumivel','desgaste'], w:0 },
    calibration: { kw:['calibracao','calibrar','offset','ajuste fino','alinhar','teaching','teach','zero','referencia'], w:0 },
  };
  for (const [name,cfg] of Object.entries(agents)) { for (const kw of cfg.kw) { if (ql.includes(kw)) cfg.w += kw.length > 5 ? 2 : 1; } }
  const best = Object.entries(agents).sort((a,b) => b[1].w - a[1].w)[0];
  if (best[1].w >= 1) { console.log(`🤖 Agente: ${best[0]} (score ${best[1].w})`); return best[0]; }
  return 'general';
}

const AGENT_PROMPTS = {
  error: '\nMODO AGENTE DE ERROS: Identifique código de erro, busque na tabela do manual, liste TODAS as causas com % de probabilidade.',
  procedure: '\nMODO AGENTE PROCEDIMENTOS: Encontre procedimento EXATO no manual, liste etapas claras com valores e ferramentas.',
  diagnostic: '\nMODO AGENTE DIAGNÓSTICO: Analise sintomas, liste causas em ordem de probabilidade, sugira testes de verificação.',
  maintenance: '\nMODO AGENTE MANUTENÇÃO: Identifique cronograma, peças, intervalos, sinais de desgaste.',
  calibration: '\nMODO AGENTE CALIBRAÇÃO: Detalhe procedimento, pré-requisitos, valores de referência e tolerâncias.',
  general: ''
};

// ── 10. AUTO-VALIDAÇÃO ──────────────────────────────────────────────────────
function autoValidate(answer, question, manuals) {
  let score = 100;
  const al = answer.toLowerCase();
  const ptWords = ['de','que','para','com','não','por','uma','como'];
  if (ptWords.filter(w => al.includes(` ${w} `)).length < 3) score -= 15;
  if (!/🟢|🟡|🔴|⚫|NÍVEL/i.test(answer) && answer.length > 200) score -= 10;
  if (answer.includes('%%PAGINAS%%')) score -= 10;
  if (answer.length < 100) score -= 15;
  const confidence = Math.max(0, Math.min(100, score));
  console.log(`${confidence >= 80 ? '✅' : '⚠️'} Auto-validação: ${confidence}%`);
  return confidence;
}

// ── 11. INDEXAÇÃO DE PÁGINAS ────────────────────────────────────────────────
async function buildPageIndex(filePath, totalPages) {
  if (!totalPages || path.extname(filePath).toLowerCase() !== '.pdf') return [];
  try {
    const pdfParse = require('pdf-parse'); const pageTexts = [];
    await pdfParse(fs.readFileSync(filePath), { pagerender: async (pd) => { try { const c=await pd.getTextContent(); const t=c.items.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim(); pageTexts.push(t); return t; } catch { pageTexts.push(''); return ''; } } });
    const ignoreRE=[/^-?\s*\d+\s*-?$/,/^[A-Z]{2,}\d+-\d+/,/^copyright/i,/^page\s+\d+/i];
    const secRE=[/^(\d+\.?\d*)\s+[A-ZÀ-Ÿ].{4,}/,/^[A-Z][A-Z\s]{4,60}$/];
    return pageTexts.map((text,idx) => {
      const lines=text.split(/[.\n]/).map(l=>l.trim()).filter(l=>l.length>4&&!ignoreRE.some(r=>r.test(l)));
      const titles=lines.filter(l=>secRE.some(r=>r.test(l))).slice(0,2);
      const others=lines.filter(l=>!secRE.some(r=>r.test(l))&&l.length<120).slice(0,2);
      const summary=[...titles,...others].slice(0,3).join(' | ').substring(0,200);
      return summary?{page:idx+1,summary}:null;
    }).filter(Boolean);
  } catch(e) { console.warn('Indexação falhou:', e.message); return []; }
}

// ── 12. EXTRAÇÃO DE IMAGENS (Ghostscript) ───────────────────────────────────
async function extractPageImages(filePath, manualId, totalPages) {
  if (path.extname(filePath).toLowerCase()!=='.pdf') return [];
  const outDir = path.join(PAGINAS_DIR, manualId);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, {recursive:true});
  const max = Math.min(totalPages||300, 300);
  const gsPaths = ['C:\\Program Files\\gs\\gs10.07.0\\bin\\gswin64c.exe','C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe','/usr/bin/gs','gswin64c','gs'];
  let gsExe = null;
  for (const p of gsPaths) { try { if(p.includes('\\')){if(fs.existsSync(p)){gsExe=p;break;}}else{execSync(`which ${p}`,{stdio:'pipe'});gsExe=p;break;} } catch{} }
  if (!gsExe) { console.warn('⚠️ Ghostscript não encontrado.'); return []; }
  console.log(`Usando Ghostscript: ${gsExe}\nExtraindo imagens de ${max} páginas...`);
  try { execSync(`"${gsExe}" -dBATCH -dNOPAUSE -dSAFER -sDEVICE=jpeg -r150 -dJPEGQ=85 -dFirstPage=1 -dLastPage=${max} -sOutputFile="${path.join(outDir,'pag_%04d.jpg')}" "${filePath}"`, {timeout:300000,stdio:'pipe'}); } catch(e) { console.warn('GS erro:', e.message?.substring(0,150)); }
  const pages = [];
  for (let i=1;i<=max;i++) { const pad=String(i).padStart(4,'0'); if(fs.existsSync(path.join(outDir,`pag_${pad}.jpg`))) pages.push({page:i,url:`/paginas/${manualId}/pag_${pad}.jpg`}); }
  console.log(`✅ ${pages.length} imagens extraídas.`);
  return pages;
}

// ── 13. APIs DE IA ──────────────────────────────────────────────────────────
async function askGemini(prompt, msg, key, retries=3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  for (let a=1;a<=retries;a++) {
    try {
      const r = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:msg}]}],generationConfig:{temperature:0.2,maxOutputTokens:16384,topP:0.8}})});
      if(r.status===429||r.status===503){console.log(`Gemini sobrecarregado (${a}/${retries})...`);await new Promise(r=>setTimeout(r,a*8000));continue;}
      if(!r.ok){const e=await r.json();const m=e.error?.message||'Erro';if(m.includes('high demand')){await new Promise(r=>setTimeout(r,a*8000));continue;}throw new Error(m);}
      const d=await r.json(); return d.candidates?.[0]?.content?.parts?.[0]?.text||'';
    } catch(e){if(a===retries)throw e;await new Promise(r=>setTimeout(r,a*8000));}
  }
}

async function askClaude(prompt, msg, key, model='claude-sonnet-4-5', retries=3) {
  for (let a=1;a<=retries;a++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:8192,system:prompt,messages:[{role:'user',content:msg}]})});
      if(r.status===429||r.status===529){await new Promise(r=>setTimeout(r,a*8000));continue;}
      if(!r.ok){const e=await r.json();throw new Error(e.error?.message||'Erro Claude');}
      return (await r.json()).content?.[0]?.text||'';
    } catch(e){if(a===retries)throw e;await new Promise(r=>setTimeout(r,a*8000));}
  }
}

async function askLMStudio(prompt, msg, model='local-model') {
  const r = await fetch('http://localhost:1234/v1/chat/completions', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:prompt},{role:'user',content:msg}],temperature:0.2,max_tokens:4096,stream:false})});
  if(!r.ok)throw new Error(`LM Studio erro ${r.status}`);
  return (await r.json()).choices?.[0]?.message?.content||'';
}

async function askOllama(prompt, msg, model='llama3') {
  try {
    const r=await fetch('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,messages:[{role:'system',content:prompt},{role:'user',content:msg}],options:{temperature:0.2,num_predict:4096}})});
    if(r.ok){const t=await r.text();const lines=t.trim().split('\n').filter(Boolean);let res='';for(const l of lines){try{const o=JSON.parse(l);if(o.message?.content)res+=o.message.content;if(o.done)break;}catch{}}if(res)return res.trim();}
  } catch{}
  const r2=await fetch('http://localhost:11434/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:false,prompt:`${prompt}\n\nUsuário: ${msg}\n\nOráculo:`,options:{temperature:0.2,num_predict:4096}})});
  if(!r2.ok)throw new Error('Ollama erro');
  const t2=await r2.text();const lines=t2.trim().split('\n').filter(Boolean);let res='';for(const l of lines){try{const o=JSON.parse(l);if(o.response)res+=o.response;if(o.done)break;}catch{}}
  return res.trim()||'Sem resposta.';
}

// ── 14. MULTER ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (r,f,cb)=>cb(null,UPLOADS_DIR),
  filename: (r,f,cb)=>{cb(null,`${uuidv4()}_${Buffer.from(f.originalname,'latin1').toString('utf8')}`);}
});
const upload = multer({ storage, fileFilter:(r,f,cb)=>{cb(null,['.pdf','.doc','.docx'].includes(path.extname(f.originalname).toLowerCase()));}, limits:{fileSize:200*1024*1024} });

// ── 15. ROTAS ───────────────────────────────────────────────────────────────

// Endpoint de keep-alive (UptimeRobot pinga aqui a cada 5 min)
app.get('/ping', (req,res) => res.send('OK'));
app.get('/health', (req,res) => {
  const db = loadDB();
  res.json({ status:'online', version:'2.0', manuals:db.manuals.length, experiences:db.experiences.length, uptime:Math.floor(process.uptime())+'s' });
});

app.get('/api/knowledge', (req,res)=>res.json(loadDB()));
app.get('/api/cache', (req,res)=>{const c=loadCache();res.json({total:c.entries.length,entries:c.entries.map(e=>({id:e.id,question:e.question,hits:e.hits||1,mode:e.mode,createdAt:e.createdAt,pages:(e.referencedPages||[]).length}))});});
app.delete('/api/cache', (req,res)=>{saveCache({entries:[]});res.json({success:true});});
app.delete('/api/cache/:id', (req,res)=>{const c=loadCache();c.entries=c.entries.filter(e=>e.id!==req.params.id);saveCache(c);res.json({success:true});});
app.get('/api/server-keys', (req,res)=>res.json({hasGemini:!!SERVER_GEMINI_KEY,hasClaude:!!SERVER_CLAUDE_KEY}));
app.get('/api/ollama-status', async(req,res)=>{try{const r=await fetch('http://localhost:11434/api/tags',{signal:AbortSignal.timeout(2000)});const d=await r.json();res.json({running:r.ok,models:(d.models||[]).map(m=>m.name)});}catch{res.json({running:false,models:[]});}});
app.get('/api/lmstudio-status', async(req,res)=>{try{const r=await fetch('http://localhost:1234/v1/models',{signal:AbortSignal.timeout(2000)});const d=await r.json();res.json({running:r.ok,models:(d.data||[]).map(m=>m.id)});}catch{res.json({running:false,models:[]});}});

// Upload
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({error:'Arquivo inválido.'});
    const fileName = Buffer.from(req.file.originalname,'latin1').toString('utf8');
    const db = loadDB();
    if (db.manuals.find(m=>m.name===fileName)) { fs.unlinkSync(req.file.path); return res.status(400).json({error:`"${fileName}" já carregado.`}); }
    const manualId = uuidv4();
    const pdfInfo = await extractText(req.file.path);
    let pageImages = [];
    if (pdfInfo.pages > 0) pageImages = await extractPageImages(req.file.path, manualId, pdfInfo.pages);
    const extraction = await extractWithOCR(req.file.path, pageImages);
    const pageIndex = await buildPageIndex(req.file.path, extraction.pages);
    const sections = structureContent(extraction.text);
    console.log(`📊 ${sections.length} seções (${sections.filter(s=>s.type==='warning').length} warnings, ${sections.filter(s=>s.type==='error_code').length} erros)`);
    const manual = { id:manualId, name:fileName, filename:req.file.filename, path:req.file.path, size:req.file.size, pages:extraction.pages, method:extraction.method, textLength:extraction.text.length, addedAt:new Date().toISOString(), pageImages, pageIndex, sections:sections.map(s=>({type:s.type,title:s.title,preview:s.content.slice(0,3).join(' ').substring(0,150)})), textPreview:extraction.text.substring(0,200000) };
    db.manuals.push(manual); saveDB(db);
    console.log(`✅ "${fileName}" — ${extraction.pages} págs, ${pageImages.length} imgs, método: ${extraction.method}`);
    res.json({success:true,manual:{id:manual.id,name:manual.name,pages:manual.pages,method:manual.method,textLength:manual.textLength}});
  } catch(e) { console.error('Upload erro:',e); res.status(500).json({error:e.message}); }
});

app.delete('/api/manual/:id', (req,res)=>{const db=loadDB();const m=db.manuals.find(m=>m.id===req.params.id);if(m)try{if(fs.existsSync(m.path))fs.unlinkSync(m.path);}catch{}; db.manuals=db.manuals.filter(m=>m.id!==req.params.id);saveDB(db);res.json({success:true});});

app.post('/api/experience', (req,res)=>{
  const t=sanitize(req.body.title),m=sanitize(req.body.machine),a=sanitize(req.body.author),p=sanitize(req.body.problem),s=sanitize(req.body.solution);
  if(!t||!p||!s) return res.status(400).json({error:'Campos obrigatórios.'});
  const db=loadDB();db.experiences.push({id:uuidv4(),title:t,machine:m||'Geral',author:a||'Anônimo',problem:p,solution:s,createdAt:new Date().toISOString()});saveDB(db);res.json({success:true});
});
app.delete('/api/experience/:id', (req,res)=>{const db=loadDB();db.experiences=db.experiences.filter(e=>e.id!==req.params.id);saveDB(db);res.json({success:true});});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. ROTA PRINCIPAL — QUERY (Pipeline completo)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/query', async (req, res) => {
  const { manualIds, mode, ollamaModel, lmModel, claudeModel, useServerKey, conversationHistory } = req.body;
  let question = sanitize(req.body.question);
  let { apiKey, claudeKey } = req.body;

  if (!question || question.length < 3) return res.status(400).json({error:'Pergunta inválida.'});
  if (useServerKey||!apiKey) apiKey = apiKey || SERVER_GEMINI_KEY;
  if (useServerKey||!claudeKey) claudeKey = claudeKey || SERVER_CLAUDE_KEY;
  if (mode==='gemini'&&!apiKey) return res.status(400).json({error:'Chave Gemini não disponível.'});
  if (mode==='claude'&&!claudeKey) return res.status(400).json({error:'Chave Claude não disponível.'});

  // ── Cache ──
  const cached = findInCache(question, manualIds);
  if (cached) { bumpCacheHit(cached.id); return res.json({success:true,answer:cached.answer+`\n\n_💾 Cache (${cached.hits}× — ${(cached.score*100).toFixed(0)}%)_`,referencedPages:cached.referencedPages||[],fromCache:true}); }

  const db = loadDB();
  const manuals = manualIds?.length ? db.manuals.filter(m=>manualIds.includes(m.id)) : db.manuals;
  const isSmall = mode==='ollama';

  // ── Agente especializado ──
  const agent = detectAgent(question);

  // ── Banco de Conhecimento Local (busca ANTES da IA) ──
  const kbResult = searchKB(question);

  // ── RAG Cross-Manual ──
  const { chunks: ragChunks, hits: manualHits } = ragCrossManual(manuals, question, isSmall ? 5 : 20);

  // ── Monta contexto dos manuais ──
  let manualsCtx = '';

  // INVENTÁRIO COMPLETO — sempre lista TODOS os manuais carregados
  manualsCtx += '\n=== INVENTÁRIO COMPLETO DE MANUAIS CARREGADOS ===\n';
  manualsCtx += `Total: ${manuals.length} manual(is) na base de dados\n\n`;
  manuals.forEach((m, i) => {
    manualsCtx += `${i+1}. "${m.name}" — ${m.pages||'?'} páginas | ${(m.textLength/1000).toFixed(0)}k caracteres | método: ${m.method||'text'} | adicionado: ${m.addedAt?.substring(0,10)||'?'}\n`;
  });
  manualsCtx += '\n--- FIM DO INVENTÁRIO ---\n';

  // RAG — conteúdo relevante dos manuais mais pertinentes à pergunta
  const grouped = {};
  ragChunks.forEach(c => { if(!grouped[c.manual])grouped[c.manual]=[]; grouped[c.manual].push(c.text); });

  for (const [mName, texts] of Object.entries(grouped)) {
    const m = manuals.find(x => x.name === mName);
    let block = `\n\n=== MANUAL: ${mName} (${m?.pages||'?'} págs | ${manualHits[mName]||0} hits de relevância) ===\n`;
    if (m?.pageIndex?.length) {
      block += `\nÍNDICE DE PÁGINAS:\n`;
      m.pageIndex.slice(0, isSmall ? 20 : 80).forEach(idx => { block += `Pág ${idx.page}: ${idx.summary}\n`; });
      block += `\n`;
    }
    block += `CONTEÚDO RELEVANTE (RAG):\n${texts.join('\n---\n')}\n`;

    // Para o manual MAIS relevante, inclui texto completo como backup
    // Garante que procedimentos longos não sejam cortados pelo chunking
    const topManualName = Object.entries(manualHits).sort((a,b)=>b[1]-a[1])[0]?.[0];
    if (mName === topManualName && m?.textPreview && !isSmall) {
      const extraLimit = 55000;
      block += `\nCONTEÚDO COMPLETO DO MANUAL PRINCIPAL (para procedimentos detalhados):\n${m.textPreview.substring(0, extraLimit)}\n`;
      console.log(`📖 Contexto estendido: +${Math.min(m.textPreview.length, extraLimit)} chars de "${mName}"`);
    }

    manualsCtx += block;
  }

  // Se RAG não encontrou nada, envia texto bruto
  if (!manualsCtx && manuals.length) {
    manuals.forEach(m => { if(m.textPreview) manualsCtx += `\n\n=== ${m.name} ===\n${m.textPreview.substring(0, isSmall?8000:40000)}\n`; });
  }

  // ── Experiências ──
  let expCtx = '';
  if (db.experiences.length) { expCtx = '\n\n=== EXPERIÊNCIAS TÉCNICAS ===\n'; db.experiences.forEach(e => { expCtx += `[${e.machine}] ${e.title}: ${e.problem} → ${e.solution}\n`; }); }

  // ── Histórico (raciocínio contextual) ──
  let histCtx = '';
  if (conversationHistory?.length) {
    histCtx = '\n\n=== HISTÓRICO DA CONVERSA (use para entender o contexto das perguntas de acompanhamento) ===\n';
    conversationHistory.slice(-10).forEach(msg => {
      const role = msg.role === 'user' ? 'TÉCNICO' : 'ORÁCULO';
      histCtx += `${role}: ${(msg.content||'').substring(0, 600)}\n\n`;
    });
    histCtx += '--- FIM DO HISTÓRICO ---\nIMPORTANTE: Se a pergunta atual faz referência a algo do histórico (ex: "explique melhor", "e o passo 5?", "qual outra opção?"), use o contexto acima para entender o que o técnico quer.\n';
    console.log(`💬 Histórico: ${conversationHistory.length} mensagens`);
  }

  // ── System Prompt Unificado ──
  const localPrefix = (mode === 'ollama' || mode === 'lmstudio')
    ? `[INSTRUÇÃO CRÍTICA] Você DEVE responder SOMENTE em PORTUGUÊS DO BRASIL. NUNCA use inglês. Inclua diagnóstico com porcentagens e níveis 🟢🟡🔴⚫.\n\n`
    : '';

  const systemPrompt = `${localPrefix}Você é o ORÁCULO SMT — um engenheiro especialista sênior em SMT (Surface Mount Technology) com 30 anos de experiência. Criado por Jimmy Hendrix Queiroz. Você pensa e analisa como um ser humano experiente.

═══ COMO VOCÊ PENSA (processo mental obrigatório antes de responder) ═══

PASSO 1 — COMPREENSÃO PROFUNDA DA PERGUNTA:
Antes de buscar no manual, entenda completamente o que o técnico precisa.
- Qual é o equipamento envolvido?
- Qual é o contexto da situação? (manutenção, erro, instalação, calibração?)
- O que ele realmente quer saber? (pode estar nas entrelinhas)
- Existem termos técnicos que podem ter variações? (ex: "MT reset" = "motor table reset" = "reinicialização da mesa" = "initialize motor")

PASSO 2 — VARREDURA COMPLETA DO MANUAL:
Leia TODA a base de conhecimento fornecida como se estivesse estudando o manual pela primeira vez.
- Não pare no primeiro trecho que pareça relevante — continue lendo TODO o conteúdo
- Procure em TODAS as seções: índice, procedimentos, tabelas de erro, especificações, notas, warnings, apêndices
- Cruze informações de diferentes partes do manual (ex: um procedimento na página 50 pode ter pré-requisitos na página 30)
- Busque o termo em MÚLTIPLAS variações: português, inglês, siglas, sinônimos técnicos

PASSO 3 — ORGANIZAÇÃO COMPLETA DA RESPOSTA:
Depois de encontrar TUDO que é relevante, organize a resposta de forma EXAUSTIVA:
- NÃO resuma. NÃO pule passos. NÃO simplifique procedimentos.
- Cada passo do manual deve ser explicado com o MESMO nível de detalhe do original
- Se o manual diz "ajuste para 0.5mm ± 0.02mm usando ferramenta JIG-001", repita EXATAMENTE isso
- Se há 15 passos no procedimento, liste TODOS os 15 — não agrupe nem pule nenhum
- Inclua TODOS os valores: pressão (kPa), torque (N·m), temperatura (°C), tolerâncias (mm), tempos (s/min)
- Inclua TODAS as advertências: WARNING, CAUTION, DANGER, notas importantes
- Se há pré-requisitos, liste-os ANTES do procedimento
- Se há verificações pós-procedimento, liste-as DEPOIS

═══ REGRAS ABSOLUTAS ═══

1. Responda SEMPRE em português do Brasil, traduzindo termos técnicos do manual mas mantendo nomenclaturas originais entre parênteses. Ex: "Reinicialização da Mesa (MT Reset)"
2. NUNCA invente informações. Se não encontrar no manual, diga: "Esta informação não consta nos manuais carregados."
3. PRIORIZE o BANCO DE CONHECIMENTO SMT LOCAL quando disponível — são dados verificados e confiáveis. Use-os como base e complemente com os manuais.
3. NUNCA resuma procedimentos — transcreva CADA passo com TODOS os detalhes
4. Quando citar valores do manual, cite-os EXATAMENTE como aparecem
5. Ao final de CADA resposta: _🔧 ORÁCULO SMT — Criado por Jimmy Hendrix Queiroz_

═══ DESAMBIGUAÇÃO ═══
Se pergunta GENÉRICA + 2+ manuais diferentes → retorne:
%%CLARIFICAR%%{"pergunta":"Em qual equipamento está o problema?","opcoes":["Manual1","Manual2"]}%%CLARIFICAR%%
NÃO clarifique se: já menciona equipamento, só 1 manual, ou código de erro específico.

LISTAGEM: Se perguntarem quais manuais existem, liste TODOS do INVENTÁRIO COMPLETO sem omitir nenhum.

═══ ESTRUTURA DA RESPOSTA ═══

1. **DIAGNÓSTICO PROVÁVEL** com causas e probabilidade:
   "Causa 1 (65%): ... | Causa 2 (25%): ... | Causa 3 (10%): ..."

2. **PRÉ-REQUISITOS** (se aplicável):
   Ferramentas, condições, warm-up, estado da máquina antes de começar.

3. **PROCEDIMENTO COMPLETO** organizado por dificuldade:

**🟢 NÍVEL 1 — VERIFICAÇÕES SIMPLES** (1-5 min, operador)
Verificações visuais, limpeza, reinício, reconexão — sem ferramentas.
Liste CADA verificação individualmente com detalhes.

**🟡 NÍVEL 2 — AJUSTES INTERMEDIÁRIOS** (10-30 min, técnico)
Calibração, parâmetros, troca consumíveis, menus de configuração.
Liste CADA ajuste com valores exatos do manual.

**🔴 NÍVEL 3 — INTERVENÇÕES COMPLEXAS** (técnico especializado)
Desmontagem, substituição, ajuste mecânico fino.
Liste CADA etapa com ferramentas e tolerâncias.

**⚫ NÍVEL 4 — SUPORTE DO FABRICANTE** (último recurso)
Contato fabricante, troca de placas eletrônicas.

4. **VERIFICAÇÃO PÓS-PROCEDIMENTO**: Como confirmar que o problema foi resolvido.

5. **ADVERTÊNCIAS E SEGURANÇA**: TODOS os warnings/cautions do manual relacionados.

6. **PREVENÇÃO**: Como evitar que o problema ocorra novamente.

Pule níveis que não se aplicam. Dentro de cada nível, ordene do mais fácil ao mais difícil.

═══ INTELIGÊNCIA SEMÂNTICA ═══
Antes de dizer "não encontrado", tente no mínimo 5 variações:
- Termo original em PT e EN
- Siglas e abreviações
- Sinônimos técnicos SMT
- Termos relacionados do mesmo sistema/subsistema
- Nomes de menu/tela do software da máquina
${AGENT_PROMPTS[agent] || ''}
═══ REFERÊNCIA DE PÁGINAS ═══
Use número FÍSICO (posição real no PDF). Ao final:
%%PAGINAS%%{"manualName":"NOME_EXATO","pages":[N,N,N]}%%PAGINAS%%

Multi-fabricante: Fuji, Yamaha, Juki, DEK, MPM, Heller, Koh Young, Saki, Aurotek, HI-LO e +80 outros.
Multi-idioma: EN, PT, JP, CN, KR → sempre responde em PT-BR.

BASE DE CONHECIMENTO:
${kbResult ? '\n=== BANCO DE CONHECIMENTO SMT LOCAL (dados verificados) ===\n' + kbResult + '\n--- FIM KB LOCAL ---\n' : ''}
${manualsCtx || 'Nenhum manual carregado.'}
${expCtx}
${histCtx}`;

  // ── Executa consulta ──
  try {
    let rawAnswer;
    // Reforço para modelos locais (Ollama/LM Studio) que tendem a responder em inglês
    const localReinforce = (mode === 'ollama' || mode === 'lmstudio') ? `

ATENÇÃO MÁXIMA — REGRAS OBRIGATÓRIAS PARA ESTA RESPOSTA:
1. IDIOMA: Responda 100% em PORTUGUÊS DO BRASIL. Traduza TUDO. NUNCA responda em inglês.
2. FORMATO: Comece SEMPRE com "DIAGNÓSTICO PROVÁVEL:" seguido de causas com percentual.
   Exemplo: "Causa 1 (60%): descrição | Causa 2 (30%): descrição"
3. USE os níveis: 🟢 NÍVEL 1, 🟡 NÍVEL 2, 🔴 NÍVEL 3, ⚫ NÍVEL 4
4. Inclua TODOS os valores técnicos (pressão, torque, temperatura).
5. Finalize com: _🔧 ORÁCULO SMT — Criado por Jimmy Hendrix Queiroz_

PERGUNTA DO TÉCNICO: ` : '';

    const finalQuestion = localReinforce ? localReinforce + question : question;

    if (mode==='claude') rawAnswer = await askClaude(systemPrompt, question, claudeKey, claudeModel||'claude-sonnet-4-5');
    else if (mode==='lmstudio') rawAnswer = await askLMStudio(systemPrompt, finalQuestion, lmModel||'local-model');
    else if (mode==='ollama') rawAnswer = await askOllama(systemPrompt, finalQuestion, ollamaModel||'llama3');
    else rawAnswer = await askGemini(systemPrompt, question, apiKey);

    if (!rawAnswer?.trim()) return res.status(500).json({error:'Resposta vazia. Tente novamente.'});

    // Pós-processamento para modelos locais: detecta resposta em inglês
    if ((mode === 'ollama' || mode === 'lmstudio') && rawAnswer.length > 100) {
      const enWords = ['the','and','with','for','this','that','from','have','will','should','would','could','check','verify','make sure','replace','follow','steps'];
      const ptWords = ['que','para','com','não','uma','como','ser','está','deve','pode','verificar','trocar','seguir'];
      const lower = rawAnswer.toLowerCase();
      const enCount = enWords.filter(w => lower.includes(' '+w+' ')).length;
      const ptCount = ptWords.filter(w => lower.includes(' '+w+' ')).length;
      if (enCount > ptCount + 3) {
        console.log(`⚠️ Resposta em inglês detectada (EN:${enCount} PT:${ptCount}) — adicionando aviso`);
        rawAnswer = `⚠️ *Nota: O modelo local respondeu parcialmente em inglês. Para respostas 100% em português, use Gemini ou Claude.*\n\n---\n\n` + rawAnswer;
      }
    }

    // Clarificação
    const clarMatch = rawAnswer.match(/%%CLARIFICAR%%[\s\S]*?%%CLARIFICAR%%/);
    if (clarMatch) { try { const d=JSON.parse(clarMatch[0].replace(/%%CLARIFICAR%%/g,'').trim()); return res.json({success:true,needsClarification:true,clarification:{question:d.pergunta,options:(d.opcoes||[]).slice(0,5)}}); } catch{} }

    // Processa resposta
    let answer = rawAnswer, referencedPages = [];
    const pageMatch = rawAnswer.match(/%%PAGINAS%%[\s\S]*?%%PAGINAS%%/) || rawAnswer.match(/%%PAGINAS%%[\s\S]*/);
    if (pageMatch) {
      answer = rawAnswer.replace(/%%PAGINAS%%[\s\S]*/s, '').trim();
      try {
        const raw = pageMatch[0].replace(/%%PAGINAS%%/g,'').trim();
        const json = raw.endsWith('}') ? raw : raw + (raw.includes(']') ? '}' : ']}');
        const sanitized = json.replace(/"pages"\s*:\s*\[([^\]]*)\]?/g, (_,arr) => { const nums=(arr||'').split(',').map(s=>parseInt(s.trim())).filter(n=>!isNaN(n)&&n>0&&n<=3000); return `"pages":[${[...new Set(nums)].slice(0,5).join(',')}]`; });
        const pData = JSON.parse(sanitized);
        const mName = (pData.manualName||'').substring(0,40);
        const pages = [...new Set((pData.pages||[]).map(Number).filter(p=>p>0))].slice(0,5);
        console.log('📄 Páginas:', pages);
        const target = manuals.find(m => m.name.toLowerCase().includes(mName.toLowerCase().substring(0,15)) || mName.toLowerCase().includes(m.name.toLowerCase().substring(0,15))) || manuals[0];
        if (target?.pageImages?.length) { referencedPages = pages.map(p=>target.pageImages.find(img=>img.page===p)).filter(Boolean).map(img=>({...img,manualName:target.name})); }
      } catch(e) { console.warn('Erro páginas:', e.message); }
    }

    // Auto-validação
    autoValidate(answer, question, manuals);

    res.json({ success:true, answer, referencedPages, fromCache:false, agent });
    if (answer.length > 50) addToCache(question, answer, referencedPages, manualIds, mode||'gemini');

  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16b. ROTA STREAMING — Resposta em tempo real via SSE
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/query-stream', async (req, res) => {
  const { manualIds, mode, ollamaModel, lmModel, claudeModel, useServerKey, conversationHistory } = req.body;
  let question = sanitize(req.body.question);
  let { apiKey, claudeKey } = req.body;

  if (!question || question.length < 3) return res.status(400).json({error:'Pergunta inválida.'});
  if (useServerKey||!apiKey) apiKey = apiKey || SERVER_GEMINI_KEY;
  if (useServerKey||!claudeKey) claudeKey = claudeKey || SERVER_CLAUDE_KEY;

  // Cache check (retorna normal, sem stream)
  const cached = findInCache(question, manualIds);
  if (cached) { bumpCacheHit(cached.id); return res.json({success:true,cached:true,answer:cached.answer+`\n\n_💾 Cache (${cached.hits}×)_`,referencedPages:cached.referencedPages||[]}); }

  // SSE headers
  res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
  res.flushHeaders();

  const send = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch{} };

  try {
    const db = loadDB();
    const manuals = manualIds?.length ? db.manuals.filter(m=>manualIds.includes(m.id)) : db.manuals;
    const isSmall = mode==='ollama';
    const agent = detectAgent(question);
    const kbResult = searchKB(question);
    const { chunks: ragChunks, hits: manualHits } = ragCrossManual(manuals, question, isSmall ? 5 : 20);

    // Monta contexto (mesmo código da rota normal)
    let manualsCtx = '\n=== INVENTÁRIO COMPLETO ===\nTotal: ' + manuals.length + ' manual(is)\n';
    manuals.forEach((m,i) => { manualsCtx += `${i+1}. "${m.name}" — ${m.pages||'?'} págs | ${Math.round((m.textLength||0)/1000)}k chars\n`; });
    manualsCtx += '--- FIM INVENTÁRIO ---\n';
    const grouped = {};
    ragChunks.forEach(c => { if(!grouped[c.manual])grouped[c.manual]=[]; grouped[c.manual].push(c.text); });
    for (const [mName, texts] of Object.entries(grouped)) {
      const m = manuals.find(x => x.name === mName);
      let block = `\n\n=== MANUAL: ${mName} (${m?.pages||'?'} págs) ===\n`;
      if (m?.pageIndex?.length) { block += 'ÍNDICE:\n'; m.pageIndex.slice(0,isSmall?20:80).forEach(idx => { block += `Pág ${idx.page}: ${idx.summary}\n`; }); }
      block += `CONTEÚDO:\n${texts.join('\n---\n')}\n`;
      const topManualName = Object.entries(manualHits).sort((a,b)=>b[1]-a[1])[0]?.[0];
      if (mName === topManualName && m?.textPreview && !isSmall) { block += `\nCONTEÚDO ESTENDIDO:\n${m.textPreview.substring(0, 55000)}\n`; }
      manualsCtx += block;
    }
    if (!Object.keys(grouped).length && manuals.length) { manuals.forEach(m => { if(m.textPreview) manualsCtx += `\n=== ${m.name} ===\n${m.textPreview.substring(0,isSmall?8000:40000)}\n`; }); }
    let expCtx = '';
    if (db.experiences.length) { expCtx = '\n=== EXPERIÊNCIAS ===\n'; db.experiences.forEach(e => { expCtx += `[${e.machine}] ${e.title}: ${e.problem} → ${e.solution}\n`; }); }
    let histCtx = '';
    if (conversationHistory?.length) { histCtx = '\n=== HISTÓRICO ===\n'; conversationHistory.slice(-10).forEach(msg => { histCtx += `${msg.role==='user'?'TÉCNICO':'ORÁCULO'}: ${(msg.content||'').substring(0,600)}\n\n`; }); }

    const localPrefix = (mode==='ollama'||mode==='lmstudio') ? '[INSTRUÇÃO CRÍTICA] Responda SOMENTE em PORTUGUÊS DO BRASIL. Use diagnóstico com % e níveis 🟢🟡🔴⚫.\n\n' : '';
    const localReinforce = (mode==='ollama'||mode==='lmstudio') ? '\nATENÇÃO: Responda em PORTUGUÊS. Use níveis 🟢🟡🔴⚫ e probabilidades %.\nPERGUNTA: ' : '';

    // System prompt (versão compacta para streaming)
    const sysPrompt = `${localPrefix}Você é o ORÁCULO SMT — engenheiro especialista sênior em SMT criado por Jimmy Hendrix Queiroz.

REGRAS: 1.Responda em PT-BR 2.Baseie-se nos manuais 3.PRIORIZE o KB LOCAL 4.Nunca invente 5.Finalize com: _🔧 ORÁCULO SMT — Criado por Jimmy Hendrix Queiroz_

FORMATO: Comece com DIAGNÓSTICO PROVÁVEL (causas com %). Depois use 🟢NÍVEL1 🟡NÍVEL2 🔴NÍVEL3 ⚫NÍVEL4. Inclua TODOS os valores técnicos. NÃO resuma procedimentos.
${AGENT_PROMPTS[agent] || ''}
PÁGINAS: %%PAGINAS%%{"manualName":"NOME","pages":[N]}%%PAGINAS%%

BASE:
${kbResult ? '=== KB LOCAL ===\n' + kbResult + '\n' : ''}${manualsCtx}${expCtx}${histCtx}`;

    const finalQ = localReinforce + question;

    send({type:'start', agent});

    // ── STREAMING POR API ──
    if (mode === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;
      const r = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:sysPrompt}]},contents:[{role:'user',parts:[{text:question}]}],generationConfig:{temperature:0.2,maxOutputTokens:16384,topP:0.8}})});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||'Erro Gemini'); }
      const reader = r.body;
      let buf = '';
      let fullText = '';
      reader.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { const d = JSON.parse(line.substring(6)); const t = d.candidates?.[0]?.content?.parts?.[0]?.text||''; if(t){fullText+=t;send({type:'chunk',text:t});} } catch{}
          }
        }
      });
      await new Promise((resolve) => { reader.on('end', () => { send({type:'done',fullText}); res.end(); resolve(); }); reader.on('error', () => { send({type:'done',fullText}); res.end(); resolve(); }); });

    } else if (mode === 'claude') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {method:'POST',headers:{'Content-Type':'application/json','x-api-key':claudeKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:claudeModel||'claude-sonnet-4-5',max_tokens:8192,stream:true,system:sysPrompt,messages:[{role:'user',content:question}]})});
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message||'Erro Claude'); }
      let buf = '', fullText = '';
      r.body.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { const d = JSON.parse(line.substring(6)); if(d.type==='content_block_delta'&&d.delta?.text){fullText+=d.delta.text;send({type:'chunk',text:d.delta.text});} } catch{}
          }
        }
      });
      await new Promise((resolve) => { r.body.on('end', () => { send({type:'done',fullText}); res.end(); resolve(); }); r.body.on('error', () => { send({type:'done',fullText}); res.end(); resolve(); }); });

    } else if (mode === 'ollama') {
      const r = await fetch('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:ollamaModel||'llama3',stream:true,messages:[{role:'system',content:sysPrompt},{role:'user',content:finalQ}],options:{temperature:0.2,num_predict:4096}})});
      if (!r.ok) throw new Error('Ollama erro');
      let buf = '', fullText = '';
      r.body.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try { const d = JSON.parse(line); if(d.message?.content){fullText+=d.message.content;send({type:'chunk',text:d.message.content});} if(d.done){send({type:'done',fullText});res.end();} } catch{}
        }
      });
      await new Promise((resolve) => { r.body.on('end', () => { if(!res.writableEnded){send({type:'done',fullText});res.end();} resolve(); }); r.body.on('error', () => { if(!res.writableEnded){send({type:'done',fullText});res.end();} resolve(); }); });

    } else if (mode === 'lmstudio') {
      const r = await fetch('http://localhost:1234/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:lmModel||'local-model',stream:true,messages:[{role:'system',content:sysPrompt},{role:'user',content:finalQ}],temperature:0.2,max_tokens:4096})});
      if (!r.ok) throw new Error('LM Studio erro');
      let buf = '', fullText = '';
      r.body.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try { const d = JSON.parse(line.substring(6)); const t = d.choices?.[0]?.delta?.content||''; if(t){fullText+=t;send({type:'chunk',text:t});} } catch{}
          }
        }
      });
      await new Promise((resolve) => { r.body.on('end', () => { if(!res.writableEnded){send({type:'done',fullText});res.end();} resolve(); }); r.body.on('error', () => { if(!res.writableEnded){send({type:'done',fullText});res.end();} resolve(); }); });

    } else {
      throw new Error('Modo não suportado para streaming');
    }

    // Cache após streaming completo
    if (req._fullText && req._fullText.length > 50) addToCache(question, req._fullText, [], manualIds, mode||'gemini');

  } catch(e) {
    send({type:'error', message: e.message});
    if (!res.writableEnded) res.end();
  }
});
async function autoImportSeed() {
  const SEED_DIR = path.join(__dirname,'seed-manuals');
  const SEED_EXP = path.join(__dirname,'seed-experiences.json');
  if (!fs.existsSync(SEED_DIR)) fs.mkdirSync(SEED_DIR,{recursive:true});
  const db = loadDB(); let imported = 0;
  for (const fname of (fs.readdirSync(SEED_DIR)||[]).filter(f=>['.pdf','.doc','.docx'].includes(path.extname(f).toLowerCase()))) {
    if (db.manuals.find(m=>m.name===fname)){console.log(`📚 Já existe: ${fname}`);continue;}
    const src=path.join(SEED_DIR,fname),mid=uuidv4(),dest=path.join(UPLOADS_DIR,`${mid}_${fname}`);
    fs.copyFileSync(src,dest); console.log(`📥 Seed: ${fname}...`);
    const pdfInfo=await extractText(dest); let imgs=[]; try{if(pdfInfo.pages)imgs=await extractPageImages(dest,mid,pdfInfo.pages);}catch{}
    const ext=await extractWithOCR(dest,imgs); const idx=await buildPageIndex(dest,ext.pages);
    const secs=structureContent(ext.text);
    db.manuals.push({id:mid,name:fname,filename:`${mid}_${fname}`,path:dest,size:fs.statSync(src).size,pages:ext.pages,method:ext.method,textLength:ext.text.length,addedAt:new Date().toISOString(),pageImages:imgs,pageIndex:idx,sections:secs.map(s=>({type:s.type,title:s.title,preview:s.content.slice(0,3).join(' ').substring(0,150)})),textPreview:ext.text.substring(0,200000),seeded:true});
    imported++; console.log(`✅ ${fname} (${ext.pages} págs, ${imgs.length} imgs)`);
  }
  if(fs.existsSync(SEED_EXP)){try{const se=JSON.parse(fs.readFileSync(SEED_EXP,'utf8'));(Array.isArray(se)?se:(se.experiences||[])).forEach(exp=>{if(!db.experiences.find(e=>e.title===exp.title)){db.experiences.push({id:uuidv4(),...exp,seeded:true});imported++;console.log(`✅ Exp: ${exp.title}`);}});}catch{}}
  if(imported>0){saveDB(db);console.log(`🎉 ${imported} itens importados.\n`);}
}

// ── 18. INICIALIZAÇÃO ───────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n✅ ORÁCULO SMT v2.0 rodando em: http://localhost:${PORT}`);
  if (SERVER_GEMINI_KEY) console.log('🔑 Gemini configurado');
  if (SERVER_CLAUDE_KEY) console.log('🔑 Claude configurado');
  if (helmet) console.log('🛡️ Helmet ativo');
  if (rateLimit) console.log('🛡️ Rate limit ativo');
  loadKnowledgeBase();
  console.log('🔄 Verificando seed...');
  await autoImportSeed();

  // Auto-ping para manter servidor acordado no Render (backup do UptimeRobot)
  if (process.env.RENDER_EXTERNAL_URL || process.env.RENDER) {
    const selfUrl = process.env.RENDER_EXTERNAL_URL || `https://oraculo-smt.onrender.com`;
    setInterval(async () => {
      try { await fetch(`${selfUrl}/ping`); console.log('🏓 Auto-ping OK'); } catch {}
    }, 4 * 60 * 1000); // a cada 4 minutos
    console.log('🏓 Auto-ping ativo (4 min)');
  }

  console.log('🚀 Pronto para uso!\n');
});
