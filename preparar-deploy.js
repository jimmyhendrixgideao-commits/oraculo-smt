const fs = require('fs'), path = require('path');
const DB = path.join(__dirname, 'data', 'knowledge.json');
const UP = path.join(__dirname, 'uploads');
const SD = path.join(__dirname, 'seed-manuals');
const SE = path.join(__dirname, 'seed-experiences.json');

console.log('\n══════════════════════════════════════════════');
console.log('  ORÁCULO SMT — Preparar Deploy para Render');
console.log('══════════════════════════════════════════════\n');

if (!fs.existsSync(DB)) { console.log('⚠️  Nenhum banco local encontrado em data/knowledge.json'); process.exit(1); }
const db = JSON.parse(fs.readFileSync(DB, 'utf8'));

console.log(`📊 Banco local: ${(db.manuals||[]).length} manuais | ${(db.experiences||[]).length} experiências\n`);

// Seed de manuais
if (!fs.existsSync(SD)) fs.mkdirSync(SD, { recursive: true });
let copied = 0, skipped = 0, errors = 0, totalSize = 0;

for (const m of db.manuals || []) {
  const dest = path.join(SD, m.name);
  if (fs.existsSync(dest)) { skipped++; console.log(`  📚 Já existe: ${m.name}`); continue; }
  if (!fs.existsSync(m.path)) { errors++; console.log(`  ❌ Não encontrado: ${m.name}`); continue; }
  const size = fs.statSync(m.path).size;
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  if (size > 95 * 1024 * 1024) {
    errors++;
    console.log(`  ⚠️  GRANDE DEMAIS (${sizeMB}MB > 95MB): ${m.name}`);
    console.log(`      GitHub rejeita arquivos > 100MB. Esse manual só funciona localmente.`);
    continue;
  }
  fs.copyFileSync(m.path, dest);
  totalSize += size;
  copied++;
  console.log(`  ✅ Copiado: ${m.name} (${sizeMB} MB)`);
}

// Seed de experiências
const exps = (db.experiences || []).filter(e => e.title && e.problem && e.solution);
if (exps.length > 0) {
  fs.writeFileSync(SE, JSON.stringify({
    experiences: exps.map(e => ({
      title: e.title, machine: e.machine || 'Geral',
      problem: e.problem, solution: e.solution,
      author: e.author || 'Anônimo', createdAt: e.createdAt
    }))
  }, null, 2));
  console.log(`\n  ✅ ${exps.length} experiências exportadas para seed-experiences.json`);
}

// Resumo
console.log('\n══════════════════════════════════════════════');
console.log(`  ✅ Copiados: ${copied} manuais (${(totalSize/1024/1024).toFixed(1)} MB)`);
console.log(`  📚 Já existiam: ${skipped}`);
if (errors) console.log(`  ⚠️  Erros/Grandes: ${errors}`);
console.log(`  📝 Experiências: ${exps.length}`);
console.log('══════════════════════════════════════════════');

// Verificar tamanho total da pasta seed
let seedTotal = 0;
if (fs.existsSync(SD)) {
  fs.readdirSync(SD).forEach(f => { try { seedTotal += fs.statSync(path.join(SD, f)).size; } catch {} });
}
console.log(`\n  📦 Tamanho total seed-manuals: ${(seedTotal/1024/1024).toFixed(1)} MB`);

console.log('\n  Próximos passos:');
console.log('  ─────────────────────────────────────');
console.log('  cd C:\\Users\\jimmy\\Downloads\\oraculo-smt');
console.log('  git add .');
console.log('  git commit -m "Atualização dados"');
console.log('  git push');
console.log('  → Render faz deploy automático\n');
