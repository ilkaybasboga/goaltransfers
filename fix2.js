const fs = require('fs');
let s = fs.readFileSync('server.js', 'utf8');

// try bloğunu düzgün kapat
const oldLine = "  return JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,'').trim());";
const newLine = `  return JSON.parse(msg.content[0].text.trim().replace(/\`\`\`json|\`\`\`/g,'').trim());
  } catch(e) {
    console.error('Claude hatasi:', e.message);
    return analyzeSimple(rawText, source, lang);
  }`;

if (s.includes(oldLine)) {
  s = s.replace(oldLine, newLine);
  fs.writeFileSync('server.js', s);
  console.log('BASARILI! try-catch duzeltildi.');
} else {
  // Alternatif — satır 724 civarını bul ve düzelt
  const lines = s.split('\n');
  let fixed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("JSON.parse(msg.content[0].text.trim()") && lines[i].includes("replace(")) {
      lines[i] = lines[i] + '\n  } catch(e) {\n    console.error(\'Claude hatasi:\', e.message);\n    return analyzeSimple(rawText, source, lang);\n  }';
      fixed = true;
      console.log('BASARILI! Satir ' + (i+1) + ' duzeltildi.');
      break;
    }
  }
  if (fixed) {
    fs.writeFileSync('server.js', lines.join('\n'));
  } else {
    console.log('HATA - satir bulunamadi');
  }
}

// Syntax kontrolü
try {
  require('vm').Script && new (require('vm').Script)(s);
  console.log('Syntax OK!');
} catch(e) {
  console.log('Syntax hatasi hala var:', e.message);
}
