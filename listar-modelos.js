const https = require('https');

const API_KEY = 'AIzaSyA0D_p8_6kPo6KlSZ3P17gfELuVbDS4eFM';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}&pageSize=100`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const modelos = json.models || [];
    console.log('\n=== MODELOS COM generateContent ===\n');
    modelos.forEach(m => {
      if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
        console.log('✅ ' + m.name + ' — ' + (m.displayName || ''));
      }
    });
    console.log('\nTotal:', modelos.length, 'modelos listados.');
  });
}).on('error', e => console.error('Erro:', e.message));
