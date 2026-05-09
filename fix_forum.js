const fs = require('fs');
let s = fs.readFileSync('public/index.html', 'utf8');

// Duplicate forum if satırını kaldır
s = s.replace(
  "  if (name === 'forum')     renderForumPage(allTopics);\n",
  ""
);

// Kontrol
if (s.includes("initForumPage") && !s.includes("renderForumPage(allTopics)")) {
  fs.writeFileSync('public/index.html', s);
  console.log('BASARILI!');
} else {
  console.log('HATA - manuel kontrol gerek');
  console.log('renderForumPage var mi:', s.includes("renderForumPage(allTopics)"));
}
