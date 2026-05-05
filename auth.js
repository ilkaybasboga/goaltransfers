// ============================================================
//  GoalTransfer — Auth Modülü
//  Kullanıcı kaydı, giriş, JWT, Google OAuth
// ============================================================

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const fs        = require('fs');
const path      = require('path');

const USERS_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'users.json');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET ayarlanmamış — lütfen .env dosyasına ekleyin');
}
const _JWT_SECRET = JWT_SECRET || 'goaltransfers-temp-secret-please-change-' + Date.now();
const JWT_EXPIRES = '7d';

// ── Kullanıcı veritabanı (JSON dosyası — basit başlangıç)
// Üretimde PostgreSQL/MongoDB ile değiştir
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function saveUsers(users) {
  if (!fs.existsSync(path.dirname(USERS_FILE))) {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUser(predicate) {
  return loadUsers().find(predicate);
}

function findUserById(id) {
  return findUser(u => u.id === id);
}

// ── JWT üret
function signToken(userId) {
  return jwt.sign({ id: userId }, _JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── JWT doğrula (middleware)
function requireAuth(req, res, next) {
  const auth   = req.headers.authorization || '';
  const cookie = req.cookies?.token || '';
  const token  = auth.startsWith('Bearer ') ? auth.slice(7) : cookie;

  if (!token) return res.status(401).json({ success: false, error: 'Giriş yapman gerekiyor' });

  try {
    const payload = jwt.verify(token, _JWT_SECRET);
    const user    = findUserById(payload.id);
    if (!user) return res.status(401).json({ success: false, error: 'Kullanıcı bulunamadı' });
    req.user = sanitize(user);
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Geçersiz veya süresi dolmuş token' });
  }
}

// ── Opsiyonel auth (giriş yapmamış da geçebilir)
function optionalAuth(req, res, next) {
  const auth   = req.headers.authorization || '';
  const cookie = req.cookies?.token || '';
  const token  = auth.startsWith('Bearer ') ? auth.slice(7) : cookie;
  if (token) {
    try {
      const payload = jwt.verify(token, _JWT_SECRET);
      const user    = findUserById(payload.id);
      if (user) req.user = sanitize(user);
    } catch {}
  }
  next();
}

// ── Şifreyi gizle
function sanitize(user) {
  const { password, googleId, ...safe } = user;
  return safe;
}

// ── KAYIT (e-posta + şifre)
async function register(email, username, password) {
  const users = loadUsers();

  if (users.find(u => u.email === email.toLowerCase())) {
    throw new Error('Bu e-posta zaten kayıtlı');
  }
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('Bu kullanıcı adı alınmış');
  }
  if (password.length < 6) {
    throw new Error('Şifre en az 6 karakter olmalı');
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = {
    id         : Date.now().toString(36) + Math.random().toString(36).slice(2),
    email      : email.toLowerCase().trim(),
    username   : username.trim(),
    password   : hashed,
    avatar     : `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(username)}`,
    bio        : '',
    favoriteClub: '',
    joinedAt   : new Date().toISOString(),
    postCount  : 0,
    likedPosts : [],
    provider   : 'local',
  };

  users.push(user);
  saveUsers(users);
  return sanitize(user);
}

// ── GİRİŞ (e-posta + şifre)
async function login(email, password) {
  const user = findUser(u => u.email === email.toLowerCase());
  if (!user) throw new Error('E-posta veya şifre hatalı');
  if (!user.password) throw new Error('Bu hesap Google ile oluşturulmuş, Google ile giriş yap');

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw new Error('E-posta veya şifre hatalı');

  return sanitize(user);
}

// ── GOOGLE OAuth — kullanıcıyı bul veya oluştur
function findOrCreateGoogleUser(profile) {
  const users = loadUsers();
  let user = users.find(u => u.googleId === profile.id);

  if (!user) {
    // E-posta zaten varsa mevcut hesaba bağla
    const existing = users.find(u => u.email === profile.emails?.[0]?.value?.toLowerCase());
    if (existing) {
      existing.googleId = profile.id;
      if (!existing.avatar || existing.avatar.includes('dicebear')) {
        existing.avatar = profile.photos?.[0]?.value || existing.avatar;
      }
      saveUsers(users);
      return sanitize(existing);
    }

    // Yeni kullanıcı oluştur
    user = {
      id           : Date.now().toString(36) + Math.random().toString(36).slice(2),
      email        : profile.emails?.[0]?.value?.toLowerCase() || '',
      username     : profile.displayName?.replace(/\s+/g, '_') || 'user_' + Date.now(),
      googleId     : profile.id,
      avatar       : profile.photos?.[0]?.value || '',
      bio          : '',
      favoriteClub : '',
      joinedAt     : new Date().toISOString(),
      postCount    : 0,
      likedPosts   : [],
      provider     : 'google',
    };
    users.push(user);
    saveUsers(users);
  }
  return sanitize(user);
}

// ── PROFİL GÜNCELLE
function updateProfile(userId, updates) {
  const users = loadUsers();
  const idx   = users.findIndex(u => u.id === userId);
  if (idx === -1) throw new Error('Kullanıcı bulunamadı');

  const allowed = ['username', 'bio', 'favoriteClub', 'avatar'];
  allowed.forEach(k => {
    if (updates[k] !== undefined) users[idx][k] = updates[k];
  });

  saveUsers(users);
  return sanitize(users[idx]);
}

// ── BEĞEN / BEĞENME
function toggleLike(userId, postId) {
  const users = loadUsers();
  const user  = users.find(u => u.id === userId);
  if (!user) throw new Error('Kullanıcı bulunamadı');

  if (!user.likedPosts) user.likedPosts = [];
  const idx = user.likedPosts.indexOf(postId);
  if (idx > -1) user.likedPosts.splice(idx, 1);
  else user.likedPosts.push(postId);

  saveUsers(users);
  return { liked: idx === -1, likedPosts: user.likedPosts };
}

// ── ŞİFRE DEĞİŞTİR
async function changePassword(userId, oldPassword, newPassword) {
  const users = loadUsers();
  const user  = users.find(u => u.id === userId);
  if (!user) throw new Error('Kullanıcı bulunamadı');
  if (!user.password) throw new Error('Google hesabında şifre değişikliği yapılamaz');
  if (newPassword.length < 6) throw new Error('Yeni şifre en az 6 karakter olmalı');

  const ok = await bcrypt.compare(oldPassword, user.password);
  if (!ok) throw new Error('Mevcut şifre hatalı');

  user.password = await bcrypt.hash(newPassword, 12);
  saveUsers(users);
  return true;
}

// ── ŞİFRE SIFIRLAMA TOKEN (basit - production'da email gönderilmeli)
const resetTokens = new Map(); // token → { userId, expires }

function createResetToken(email) {
  const users = loadUsers();
  const user  = users.find(u => u.email === email.toLowerCase());
  if (!user) throw new Error('Bu e-posta ile kayıtlı kullanıcı bulunamadı');
  if (!user.password) throw new Error('Google hesabı için şifre sıfırlama yapılamaz');

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  resetTokens.set(token, { userId: user.id, expires: Date.now() + 3600000 }); // 1 saat
  return { token, username: user.username }; // Production'da email gönder
}

async function resetPassword(token, newPassword) {
  const data = resetTokens.get(token);
  if (!data) throw new Error('Geçersiz veya süresi dolmuş token');
  if (Date.now() > data.expires) { resetTokens.delete(token); throw new Error('Token süresi dolmuş'); }
  if (newPassword.length < 6) throw new Error('Şifre en az 6 karakter olmalı');

  const users = loadUsers();
  const user  = users.find(u => u.id === data.userId);
  if (!user) throw new Error('Kullanıcı bulunamadı');

  user.password = await bcrypt.hash(newPassword, 12);
  saveUsers(users);
  resetTokens.delete(token);
  return true;
}

module.exports = {
  register, login, findOrCreateGoogleUser,
  updateProfile, toggleLike,
  changePassword, createResetToken, resetPassword,
  requireAuth, optionalAuth,
  sanitize, findUserById, signToken, loadUsers,
};
