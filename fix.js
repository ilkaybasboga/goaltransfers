const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');

if (s.includes('analyzeSimple')) {
  console.log('Zaten güncel!');
  process.exit(0);
}

const simpleFn = `
function analyzeSimple(r, src, lang) {
  const t = r.toLowerCase();
  const isT = /transfer|sign|move|deal|fee|million|loan/i.test(t);
  const isI = /injur|hurt|surgery/i.test(t);
  const isM = /match|goal|score|win|lose/i.test(t);
  const type = isT ? 'transfer' : isI ? 'injury' : isM ? 'match' : 'general';
  return {
    title: r.slice(0, 80).split('\\n')[0].trim(),
    summary: r.slice(0, 200),
    type,
    importance: /million|confirmed|official/i.test(t) ? 'high' : 'medium',
    clubs: [], player: null, fee: null,
    from_club: null, to_club: null,
    transfer_status: isT ? 'rumor' : null,
    forum_title: r.slice(0, 60),
    tags: [type], lang,
  };
}
`;

// analyzeSimple fonksiyonunu ekle
s = s.replace(
  'async function analyzeWithClaude(rawText, source, lang',
  simpleFn + '\nasync function analyzeWithClaude(rawText, source, lang'
);

// API key yoksa fallback
s = s.replace(
  'const langInstr = LANG_PROMPTS[lang] || LANG_PROMPTS.en;',
  'if (!process.env.ANTHROPIC_API_KEY) return analyzeSimple(rawText, source, lang);\n  try {\n  const langInstr = LANG_PROMPTS[lang] || LANG_PROMPTS.en;'
);

// try-catch kapat
s = s.replace(
  "return JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,'').trim());",
  "return JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,'').trim());\n  } catch(e) { console.error('Claude hatasi:', e.message); return analyzeSimple(rawText, source, lang); }"
);

fs.writeFileSync('server.js', s);
console.log(s.includes('analyzeSimple') ? 'BASARILI!' : 'HATA - bulunamadi');
