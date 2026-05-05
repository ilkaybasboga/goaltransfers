// ============================================================
//  GoalTransfer — Bildirim Modülü
//  Anlık bildirimler: transfer haberi, yorum, beğeni
// ============================================================

const fs   = require('fs');
const path = require('path');

const NOTIF_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'notifications.json');

function load() {
  try {
    if (!fs.existsSync(NOTIF_FILE)) return {};
    return JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8'));
  } catch { return {}; }
}

function save(data) {
  if (!fs.existsSync(path.dirname(NOTIF_FILE)))
    fs.mkdirSync(path.dirname(NOTIF_FILE), { recursive: true });
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(data, null, 2));
}

// userId → [{id, type, title, body, link, read, date}]
function getUserNotifs(userId) {
  const all = load();
  return (all[userId] || [])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 50);
}

function getUnreadCount(userId) {
  return getUserNotifs(userId).filter(n => !n.read).length;
}

function createNotif(userId, type, title, body, link = null) {
  const all = load();
  if (!all[userId]) all[userId] = [];

  const notif = {
    id   : Date.now().toString(36) + Math.random().toString(36).slice(2),
    type,   // 'transfer' | 'comment' | 'like' | 'reply' | 'system'
    title,
    body,
    link,
    read : false,
    date : new Date().toISOString(),
  };

  all[userId].unshift(notif);
  // Max 100 bildirim sakla
  all[userId] = all[userId].slice(0, 100);
  save(all);
  return notif;
}

function markRead(userId, notifId = null) {
  const all = load();
  if (!all[userId]) return;
  if (notifId) {
    const n = all[userId].find(n => n.id === notifId);
    if (n) n.read = true;
  } else {
    all[userId].forEach(n => n.read = true);
  }
  save(all);
}

function deleteNotif(userId, notifId) {
  const all = load();
  if (!all[userId]) return;
  all[userId] = all[userId].filter(n => n.id !== notifId);
  save(all);
}

// Tüm kullanıcılara sistem bildirimi gönder
function broadcastToAll(loadUsersFn, type, title, body, link = null) {
  const users = loadUsersFn();
  users.forEach(u => createNotif(u.id, type, title, body, link));
}

module.exports = {
  getUserNotifs, getUnreadCount,
  createNotif, markRead, deleteNotif,
  broadcastToAll,
};
