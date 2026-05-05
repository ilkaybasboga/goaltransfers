// ============================================================
//  GoalTransfer — Yorum Modülü
//  Forum konularına yorum, beğeni, yanıt sistemi
// ============================================================

const fs   = require('fs');
const path = require('path');

const COMMENTS_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'comments.json');

function load() {
  try {
    if (!fs.existsSync(COMMENTS_FILE)) return {};
    return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
  } catch { return {}; }
}

function save(data) {
  if (!fs.existsSync(path.dirname(COMMENTS_FILE)))
    fs.mkdirSync(path.dirname(COMMENTS_FILE), { recursive: true });
  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2));
}

// topicId → [{id, userId, username, avatar, text, likes, likedBy, parentId, date, edited}]
function getComments(topicId) {
  const all = load();
  return (all[topicId] || []).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function addComment(topicId, user, text, parentId = null) {
  if (!text || text.trim().length < 2) throw new Error('Yorum çok kısa');
  if (text.length > 1000) throw new Error('Yorum en fazla 1000 karakter olabilir');

  const all = load();
  if (!all[topicId]) all[topicId] = [];

  const comment = {
    id       : Date.now().toString(36) + Math.random().toString(36).slice(2),
    topicId,
    userId   : user.id,
    username : user.username,
    avatar   : user.avatar || '',
    text     : text.trim(),
    likes    : 0,
    likedBy  : [],
    parentId : parentId || null,
    date     : new Date().toISOString(),
    edited   : false,
  };

  all[topicId].push(comment);
  save(all);
  return comment;
}

function editComment(topicId, commentId, userId, newText) {
  if (!newText || newText.trim().length < 2) throw new Error('Yorum çok kısa');
  const all = load();
  const comments = all[topicId] || [];
  const c = comments.find(c => c.id === commentId);
  if (!c) throw new Error('Yorum bulunamadı');
  if (c.userId !== userId) throw new Error('Bu yorumu düzenleyemezsin');

  c.text   = newText.trim();
  c.edited = true;
  save(all);
  return c;
}

function deleteComment(topicId, commentId, userId, isAdmin = false) {
  const all      = load();
  const comments = all[topicId] || [];
  const idx      = comments.findIndex(c => c.id === commentId);
  if (idx === -1) throw new Error('Yorum bulunamadı');
  if (comments[idx].userId !== userId && !isAdmin) throw new Error('Bu yorumu silemezsin');

  comments.splice(idx, 1);
  // Alt yanıtları da sil
  all[topicId] = comments.filter(c => c.parentId !== commentId);
  save(all);
  return true;
}

function likeComment(topicId, commentId, userId) {
  const all      = load();
  const comments = all[topicId] || [];
  const c        = comments.find(c => c.id === commentId);
  if (!c) throw new Error('Yorum bulunamadı');

  if (!c.likedBy) c.likedBy = [];
  const idx = c.likedBy.indexOf(userId);
  if (idx > -1) {
    c.likedBy.splice(idx, 1);
    c.likes = Math.max(0, c.likes - 1);
  } else {
    c.likedBy.push(userId);
    c.likes++;
  }

  save(all);
  return { liked: idx === -1, likes: c.likes };
}

function getCommentCount(topicId) {
  const all = load();
  return (all[topicId] || []).length;
}

function getAllCommentCounts() {
  const all = load();
  const counts = {};
  Object.keys(all).forEach(k => { counts[k] = all[k].length; });
  return counts;
}

module.exports = {
  getComments, addComment, editComment,
  deleteComment, likeComment,
  getCommentCount, getAllCommentCounts,
};
