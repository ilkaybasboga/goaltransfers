const fs = require('fs');
const path = require('path');

let s = fs.readFileSync('server.js', 'utf8');

// FOLLOW_FILE satırını bul ve DATA_DIR tanımından sonraya taşı
const followLine = "const FOLLOW_FILE = path.join(DATA_DIR, 'follows.json');";

// Önce FOLLOW_FILE'ı yerinden kaldır
s = s.replace('\n' + followLine, '');
s = s.replace(followLine + '\n', '');

// DATA_DIR ve CONFIG tanımından hemen sonrasına ekle
const insertAfter = "const CONFIG = {";
const configBlock = s.indexOf(insertAfter);
const configEnd   = s.indexOf('};', configBlock) + 2;

s = s.slice(0, configEnd) + '\n' + followLine + '\n' + s.slice(configEnd);

fs.writeFileSync('server.js', s);

// Syntax kontrolü
try {
  require('child_process').execSync('node --check server.js', { stdio: 'pipe' });
  console.log('SYNTAX OK! BASARILI!');
} catch(e) {
  console.log('HATA:', e.stderr?.toString().slice(0, 300));
}
