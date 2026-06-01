const fs = require('fs'), path = require('path');

console.log('\n══════════════════════════════════════════════');
console.log('  ORÁCULO SMT — Verificação de Dados');
console.log('══════════════════════════════════════════════\n');

// 1. Banco de dados local
const DB = path.join(__dirname, 'data', 'knowledge.json');
if (fs.existsSync(DB)) {
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  console.log('📂 BANCO LOCAL (data/knowledge.json):');
  console.log(`   Manuais: ${(db.manuals||[]).length}`);
  (db.manuals||[]).forEach((m, i) => {
    const exists = fs.existsSync(m.path) ? '✅' : '❌ ARQUIVO FALTANDO';
    console.log(`   ${i+1}. ${m.name} (${m.pages||'?'}p | ${Math.round((m.textLength||0)/1000)}k chars) ${exists}`);
  });
  console.log(`\n   Experiências: ${(db.experiences||[]).length}`);
  (db.experiences||[]).forEach((e, i) => {
    console.log(`   ${i+1}. [${e.machine||'Geral'}] ${e.title}`);
  });
} else {
  console.log('⚠️  Banco local NÃO encontrado (data/knowledge.json)');
}

// 2. Cache
const CACHE = path.join(__dirname, 'data', 'cache.json');
if (fs.existsSync(CACHE)) {
  const cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const total = cache.entries.reduce((s, e) => s + (e.hits || 1), 0);
  console.log(`\n💾 CACHE (data/cache.json): ${cache.entries.length} entradas | ${total} consultas totais`);
} else {
  console.log('\n💾 Cache: vazio');
}

// 3. Uploads
const UP = path.join(__dirname, 'uploads');
if (fs.existsSync(UP)) {
  const files = fs.readdirSync(UP).filter(f => !f.startsWith('.'));
  let totalSize = 0;
  files.forEach(f => { try { totalSize += fs.statSync(path.join(UP, f)).size; } catch {} });
  console.log(`\n📄 UPLOADS (uploads/): ${files.length} arquivos | ${(totalSize/1024/1024).toFixed(1)} MB`);
} else {
  console.log('\n📄 Uploads: pasta não existe');
}

// 4. Páginas extraídas
const PAG = path.join(__dirname, 'paginas');
if (fs.existsSync(PAG)) {
  const dirs = fs.readdirSync(PAG).filter(f => fs.statSync(path.join(PAG, f)).isDirectory());
  let totalImgs = 0;
  dirs.forEach(d => { try { totalImgs += fs.readdirSync(path.join(PAG, d)).length; } catch {} });
  console.log(`🖼️  PÁGINAS (paginas/): ${dirs.length} manuais | ${totalImgs} imagens`);
} else {
  console.log('🖼️  Páginas: pasta não existe');
}

// 5. Seed para deploy
const SD = path.join(__dirname, 'seed-manuals');
const SE = path.join(__dirname, 'seed-experiences.json');
console.log('\n🚀 SEED PARA DEPLOY:');
if (fs.existsSync(SD)) {
  const seeds = fs.readdirSync(SD).filter(f => !f.startsWith('.'));
  let seedSize = 0;
  seeds.forEach(f => { try { seedSize += fs.statSync(path.join(SD, f)).size; } catch {} });
  console.log(`   seed-manuals/: ${seeds.length} arquivos | ${(seedSize/1024/1024).toFixed(1)} MB`);
  seeds.forEach(f => { console.log(`   • ${f}`); });
} else {
  console.log('   seed-manuals/: vazio (rode: node preparar-deploy.js)');
}
if (fs.existsSync(SE)) {
  const se = JSON.parse(fs.readFileSync(SE, 'utf8'));
  console.log(`   seed-experiences.json: ${(se.experiences||[]).length} experiências`);
} else {
  console.log('   seed-experiences.json: não existe');
}

// 6. Knowledge Base
const KB = path.join(__dirname, 'smt-knowledge-base.json');
if (fs.existsSync(KB)) {
  const kb = JSON.parse(fs.readFileSync(KB, 'utf8'));
  const errs = Object.values(kb.error_codes || {}).reduce((s, a) => s + a.length, 0);
  const procs = Object.values(kb.procedures || {}).reduce((s, a) => s + a.length, 0);
  console.log(`\n📘 KB SMT: ${errs} erros | ${procs} procedimentos | ${Object.keys(kb.glossary||{}).length} termos`);
} else {
  console.log('\n📘 KB SMT: não encontrado');
}

console.log('\n══════════════════════════════════════════════');
console.log('  Para preparar deploy: node preparar-deploy.js');
console.log('══════════════════════════════════════════════\n');
