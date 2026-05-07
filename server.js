// ============================================================
//  GoalTransfer Backend v3
//  + Forum Yorumları  + Bildirimler  + Admin Paneli  + Socket.io
// ============================================================

require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const Anthropic    = require('@anthropic-ai/sdk');
const Parser       = require('rss-parser');
const cron         = require('node-cron');
const cors         = require('cors');
const fs           = require('fs');
const path         = require('path');
const cookieParser = require('cookie-parser');

let passport, GoogleStrategy;
try {
  passport       = require('passport');
  GoogleStrategy = require('passport-google-oauth20').Strategy;
} catch {}

const auth    = require('./auth');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const xss         = require('xss');
const comments = require('./comments');
const notifs  = require('./notifications');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', credentials: true } });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'GoalTransfer/3.0' } });

app.use(cors({ origin: true, credentials: true }));
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
// ── Güvenlik başlıkları
app.use(helmet({
  contentSecurityPolicy: false, // Frontend inline script kullandığı için
  crossOriginEmbedderPolicy: false,
}));

// ── Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 dakika
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Çok fazla istek, lütfen bekleyin.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                     // Auth endpoint'leri daha kısıtlı
  message: { success: false, error: 'Çok fazla giriş denemesi.' },
});
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { success: false, error: 'Çok fazla arama isteği.' },
});

app.use('/auth/register', authLimiter);
app.use('/auth/login',    authLimiter);
app.use('/api/search',    searchLimiter);
app.use(globalLimiter);

// ── XSS koruması — gelen string alanları temizle
function sanitizeInput(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') clean[k] = xss(v, { whiteList: {}, stripIgnoreTag: true });
    else if (typeof v === 'object' && v !== null) clean[k] = sanitizeInput(v);
    else clean[k] = v;
  }
  return clean;
}

app.use((req, _res, next) => {
  if (req.body) req.body = sanitizeInput(req.body);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Global hata yakalayıcı
app.use((err, req, res, _next) => {
  console.error('⚠️ Hata:', err.message);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Sunucu hatası' });
});

// ── Google OAuth
if (passport && process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID    : process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL : process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
  }, (at, rt, profile, done) => {
    try { done(null, auth.findOrCreateGoogleUser(profile)); }
    catch (err) { done(err, null); }
  }));
  app.use(passport.initialize());
}

// ── Admin kontrol middleware
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Giriş gerekli' });
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim());
  if (!adminEmails.includes(req.user.email)) {
    return res.status(403).json({ success: false, error: 'Admin yetkisi gerekli' });
  }
  req.isAdmin = true;
  next();
}

// ══════════════════════════════════════════════════════════
//  SOCKET.IO — Gerçek Zamanlı Bildirimler
// ══════════════════════════════════════════════════════════

const userSockets = new Map(); // userId → socketId

io.on('connection', (socket) => {
  // Kullanıcı kimliğini kaydet
  socket.on('register', (userId) => {
    if (userId) {
      userSockets.set(userId, socket.id);
      socket.userId = userId;
      // Bekleyen bildirim sayısını gönder
      const count = notifs.getUnreadCount(userId);
      socket.emit('notif_count', count);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) userSockets.delete(socket.userId);
  });
});

// Belirli kullanıcıya bildirim gönder
function pushNotif(userId, notif) {
  const socketId = userSockets.get(userId);
  if (socketId) {
    io.to(socketId).emit('new_notif', notif);
    io.to(socketId).emit('notif_count', notifs.getUnreadCount(userId));
  }
}

// Tüm bağlı kullanıcılara yayın yap
function broadcast(event, data) {
  io.emit(event, data);
}

// ══════════════════════════════════════════════════════════
//  AUTH ROUTE'LARI
// ══════════════════════════════════════════════════════════

app.post('/auth/register', async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password)
    return res.status(400).json({ success: false, error: 'Tüm alanlar gerekli' });
  try {
    const user  = await auth.register(email, username, password);
    const token = auth.signToken(user.id);
    res.cookie('token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });

    // Hoş geldin bildirimi
    const n = notifs.createNotif(user.id, 'system', '⚽ GoalTransfer\'ya Hoş Geldin!',
      `Merhaba ${user.username}! Forumda tartışmalara katılabilirsin.`, '/');
    res.json({ success: true, token, user });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ success: false, error: 'E-posta ve şifre gerekli' });
  try {
    const user  = await auth.login(email, password);
    const token = auth.signToken(user.id);
    res.cookie('token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });
    res.json({ success: true, token, user });
  } catch (err) { res.status(401).json({ success: false, error: err.message }); }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/auth/me', auth.requireAuth, (req, res) =>
  res.json({ success: true, user: req.user })
);

app.put('/auth/profile', auth.requireAuth, (req, res) => {
  try {
    const updated = auth.updateProfile(req.user.id, req.body);
    res.json({ success: true, user: updated });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

app.post('/auth/like/:postId', auth.requireAuth, (req, res) => {
  try {
    const result = auth.toggleLike(req.user.id, req.params.postId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

if (passport && process.env.GOOGLE_CLIENT_ID) {
  app.get('/auth/google', passport.authenticate('google', { scope: ['profile','email'] }));
  app.get('/auth/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: '/?error=google_fail' }),
    (req, res) => {
      const token = auth.signToken(req.user.id);
      res.cookie('token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });
      res.redirect('/?login=success');
    }
  );
} else {
  app.get('/auth/google', (req, res) =>
    res.status(501).json({ success: false, error: 'Google OAuth ayarlanmamış' })
  );
}

// ── Şifre değiştir
app.put('/auth/password', auth.requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword)
    return res.status(400).json({ success: false, error: 'oldPassword ve newPassword gerekli' });
  try {
    await auth.changePassword(req.user.id, oldPassword, newPassword);
    res.json({ success: true, message: 'Şifre değiştirildi' });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ── Şifre sıfırlama - token al
app.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'email gerekli' });
  try {
    const result = auth.createResetToken(email);
    // Production'da: email gönder. Şimdi: token'ı döndür (dev only)
    res.json({ success: true, message: 'Şifre sıfırlama bağlantısı oluşturuldu',
      ...(process.env.NODE_ENV !== 'production' && { token: result.token, note: 'Sadece geliştirme modunda token görünür' }) });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ── Şifre sıfırla - token kullan
app.post('/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword)
    return res.status(400).json({ success: false, error: 'token ve newPassword gerekli' });
  try {
    await auth.resetPassword(token, newPassword);
    res.json({ success: true, message: 'Şifre sıfırlandı, giriş yapabilirsiniz' });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ── Kullanıcı yorum/aktivite geçmişi
app.get('/api/users/:userId/history', auth.optionalAuth, (req, res) => {
  const all    = require('./comments').getAllCommentCounts();
  const userId = req.params.userId;
  const user   = auth.findUserById(userId);
  if (!user) return res.status(404).json({ success: false, error: 'Kullanıcı bulunamadı' });

  // Kullanıcının yorumlarını bul
  const commentsData = require('fs').existsSync(path.join(__dirname,'data','comments.json'))
    ? JSON.parse(require('fs').readFileSync(path.join(__dirname,'data','comments.json'),'utf8'))
    : {};
  const userComments = [];
  Object.entries(commentsData).forEach(([topicId, list]) => {
    list.filter(c => c.userId === userId).forEach(c => {
      userComments.push({ ...c, topicId });
    });
  });
  userComments.sort((a,b) => new Date(b.date) - new Date(a.date));

  res.json({ success: true, data: {
    user: auth.sanitize(user),
    commentCount: userComments.length,
    recentComments: userComments.slice(0, 20),
  }});
});

// ══════════════════════════════════════════════
//  TAKIM TAKİP SİSTEMİ
// ══════════════════════════════════════════════

function loadFollows() {
  try {
    if (!fs.existsSync(FOLLOW_FILE)) return {};
    return JSON.parse(fs.readFileSync(FOLLOW_FILE, 'utf8'));
  } catch { return {}; }
}
function saveFollows(data) {
  if (!fs.existsSync(path.dirname(FOLLOW_FILE)))
    fs.mkdirSync(path.dirname(FOLLOW_FILE), { recursive: true });
  fs.writeFileSync(FOLLOW_FILE, JSON.stringify(data, null, 2));
}

// POST /api/follow  { type:'team'|'player', name:'Galatasaray' }
app.post('/api/follow', auth.requireAuth, (req, res) => {
  const { type, name } = req.body;
  if (!type || !name) return res.status(400).json({ success: false, error: 'type ve name gerekli' });
  const follows = loadFollows();
  if (!follows[req.user.id]) follows[req.user.id] = { teams: [], players: [] };
  const key = type === 'player' ? 'players' : 'teams';
  const list = follows[req.user.id][key];
  const idx  = list.indexOf(name);
  if (idx > -1) list.splice(idx, 1);
  else          list.push(name);
  saveFollows(follows);
  res.json({ success: true, following: idx === -1, list });
});

// GET /api/follow  → kullanıcının takip listesi
app.get('/api/follow', auth.requireAuth, (req, res) => {
  const follows = loadFollows();
  const data    = follows[req.user.id] || { teams: [], players: [] };
  res.json({ success: true, data });
});

// GET /api/follow/feed  → takip edilen takım/oyuncu haberleri
app.get('/api/follow/feed', auth.requireAuth, (req, res) => {
  const follows = loadFollows();
  const data    = follows[req.user.id] || { teams: [], players: [] };
  const all     = [...data.teams, ...data.players].map(s => s.toLowerCase());
  if (!all.length) return res.json({ success: true, data: [] });

  const feed = newsCache.filter(n =>
    all.some(s =>
      n.title?.toLowerCase().includes(s)  ||
      n.player?.toLowerCase().includes(s) ||
      (n.clubs||[]).some(c => c.toLowerCase().includes(s)) ||
      n.from_club?.toLowerCase().includes(s) ||
      n.to_club?.toLowerCase().includes(s)
    )
  ).slice(0, 30);

  res.json({ success: true, count: feed.length, data: feed });
});

// ══════════════════════════════════════════════
//  VERİ YEDEKLEME
// ══════════════════════════════════════════════
app.get('/admin/backup', auth.requireAuth, requireAdmin, (req, res) => {
  try {
    const dataDir = path.join(__dirname, 'data');
    const backup  = {};
    ['news.json','users.json','comments.json','notifications.json','follows.json'].forEach(f => {
      const fp = path.join(dataDir, f);
      if (fs.existsSync(fp)) backup[f] = JSON.parse(fs.readFileSync(fp,'utf8'));
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="goaltransfer-backup-${Date.now()}.json"`);
    res.json({ version: '5.0', date: new Date().toISOString(), data: backup });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/admin/restore', auth.requireAuth, requireAdmin, (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ success: false, error: 'data gerekli' });
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    let restored = 0;
    Object.entries(data).forEach(([filename, content]) => {
      if (filename.endsWith('.json') && !filename.includes('/')) {
        fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(content, null, 2));
        restored++;
      }
    });
    // Cache'i yenile
    loadData();
    res.json({ success: true, message: `${restored} dosya geri yüklendi` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Otomatik yedekleme — her gece 02:00
cron.schedule('0 2 * * *', () => {
  try {
    const dataDir  = path.join(__dirname, 'data');
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backup = {};
    ['news.json','users.json','comments.json','notifications.json'].forEach(f => {
      const fp = path.join(dataDir, f);
      if (fs.existsSync(fp)) backup[f] = JSON.parse(fs.readFileSync(fp,'utf8'));
    });
    const fname = path.join(backupDir, `backup-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(fname, JSON.stringify(backup, null, 2));
    // Eski yedekleri sil (son 7 tane kalsın)
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith('backup-')).sort();
    while (files.length > 7) { fs.unlinkSync(path.join(backupDir, files.shift())); }
    console.log('💾 Otomatik yedek alındı:', fname);
  } catch (e) { console.error('Yedek hatası:', e.message); }
});

// ══════════════════════════════════════════════════════════
//  YORUM ROUTE'LARI
// ══════════════════════════════════════════════════════════

// GET /api/comments/:topicId
app.get('/api/comments/:topicId', auth.optionalAuth, (req, res) => {
  const list = comments.getComments(req.params.topicId);
  res.json({ success: true, count: list.length, data: list });
});

// POST /api/comments/:topicId
app.post('/api/comments/:topicId', auth.requireAuth, (req, res) => {
  const { text, parentId } = req.body;
  try {
    const comment = comments.addComment(req.params.topicId, req.user, text, parentId);

    // Socket ile gerçek zamanlı yayın
    broadcast('new_comment', { topicId: req.params.topicId, comment });

    // parentId varsa, yanıt verilen kullanıcıya bildirim gönder
    if (parentId) {
      const parent = comments.getComments(req.params.topicId).find(c => c.id === parentId);
      if (parent && parent.userId !== req.user.id) {
        const n = notifs.createNotif(
          parent.userId, 'reply',
          `💬 ${req.user.username} yorumunu yanıtladı`,
          text.slice(0, 80),
          `/forum/${req.params.topicId}`
        );
        pushNotif(parent.userId, n);
      }
    }

    res.json({ success: true, data: comment });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// PUT /api/comments/:topicId/:commentId
app.put('/api/comments/:topicId/:commentId', auth.requireAuth, (req, res) => {
  try {
    const updated = comments.editComment(
      req.params.topicId, req.params.commentId, req.user.id, req.body.text
    );
    broadcast('edit_comment', { topicId: req.params.topicId, comment: updated });
    res.json({ success: true, data: updated });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// DELETE /api/comments/:topicId/:commentId
app.delete('/api/comments/:topicId/:commentId', auth.requireAuth, (req, res) => {
  try {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim());
    const isAdmin = adminEmails.includes(req.user.email);
    comments.deleteComment(req.params.topicId, req.params.commentId, req.user.id, isAdmin);
    broadcast('delete_comment', { topicId: req.params.topicId, commentId: req.params.commentId });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// POST /api/comments/:topicId/:commentId/like
app.post('/api/comments/:topicId/:commentId/like', auth.requireAuth, (req, res) => {
  try {
    const result = comments.likeComment(req.params.topicId, req.params.commentId, req.user.id);
    // Yorum sahibine bildirim
    const comment = comments.getComments(req.params.topicId).find(c => c.id === req.params.commentId);
    if (comment && comment.userId !== req.user.id && result.liked) {
      const n = notifs.createNotif(
        comment.userId, 'like',
        `❤️ ${req.user.username} yorumunu beğendi`,
        comment.text.slice(0, 80),
        `/forum/${req.params.topicId}`
      );
      pushNotif(comment.userId, n);
    }
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════
//  BİLDİRİM ROUTE'LARI
// ══════════════════════════════════════════════════════════

// GET /api/notifications
app.get('/api/notifications', auth.requireAuth, (req, res) => {
  const list = notifs.getUserNotifs(req.user.id);
  res.json({ success: true, count: list.length, unread: notifs.getUnreadCount(req.user.id), data: list });
});

// PUT /api/notifications/read — Tümünü okundu işaretle
app.put('/api/notifications/read', auth.requireAuth, (req, res) => {
  notifs.markRead(req.user.id);
  io.to(userSockets.get(req.user.id))?.emit('notif_count', 0);
  res.json({ success: true });
});

// PUT /api/notifications/:id/read — Tekil okundu
app.put('/api/notifications/:id/read', auth.requireAuth, (req, res) => {
  notifs.markRead(req.user.id, req.params.id);
  res.json({ success: true, unread: notifs.getUnreadCount(req.user.id) });
});

// DELETE /api/notifications/:id
app.delete('/api/notifications/:id', auth.requireAuth, (req, res) => {
  notifs.deleteNotif(req.user.id, req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════
//  ADMİN ROUTE'LARI  (/admin/*)
// ══════════════════════════════════════════════════════════

// GET /admin/stats
app.get('/admin/stats', auth.requireAuth, requireAdmin, (req, res) => {
  const users = auth.loadUsers();
  const types = newsCache.reduce((a,n) => { a[n.type]=(a[n.type]||0)+1; return a; }, {});
  const counts = comments.getAllCommentCounts();
  const totalComments = Object.values(counts).reduce((s,c) => s+c, 0);
  res.json({ success: true, data: {
    users         : users.length,
    activeToday   : users.filter(u => {
      if (!u.lastActive) return false;
      return Date.now() - new Date(u.lastActive) < 86400000;
    }).length,
    news          : newsCache.length,
    transfers     : types.transfer || 0,
    forumTopics   : forumTopics.length,
    totalComments,
    onlineNow     : userSockets.size,
    lastFetch     : newsCache[0]?.date || null,
  }});
});

// GET /admin/users
app.get('/admin/users', auth.requireAuth, requireAdmin, (req, res) => {
  const users = auth.loadUsers().map(u => {
    const { password, googleId, ...safe } = u;
    return { ...safe, commentCount: comments.getAllCommentCounts()[u.id] || 0 };
  });
  res.json({ success: true, count: users.length, data: users });
});

// DELETE /admin/users/:id — Kullanıcı sil
app.delete('/admin/users/:id', auth.requireAuth, requireAdmin, (req, res) => {
  const users = auth.loadUsers().filter(u => u.id !== req.params.id);
  const fs2 = require('fs');
  fs2.writeFileSync(path.join(__dirname,'data','users.json'), JSON.stringify(users, null, 2));
  res.json({ success: true });
});

// GET /admin/news
app.get('/admin/news', auth.requireAuth, requireAdmin, (req, res) => {
  res.json({ success: true, count: newsCache.length, data: newsCache });
});

// DELETE /admin/news/:id — Haber sil
app.delete('/admin/news/:id', auth.requireAuth, requireAdmin, (req, res) => {
  const before = newsCache.length;
  newsCache = newsCache.filter(n => n.id !== req.params.id);
  if (newsCache.length === before)
    return res.status(404).json({ success: false, error: 'Haber bulunamadı' });
  saveData();
  res.json({ success: true });
});

// POST /admin/news — Manuel haber ekle
app.post('/admin/news', auth.requireAuth, requireAdmin, async (req, res) => {
  const { text, source = 'Admin' } = req.body;
  if (!text) return res.status(400).json({ success: false, error: 'text gerekli' });
  try {
    const analyzed = await analyzeWithClaude(text, source);
    const item = {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2),
      ...analyzed, source, link: null,
      date: new Date().toISOString(),
      likes: 0, comments: 0, views: 0,
    };
    newsCache.unshift(item);
    saveData();

    // Transfer haberi ise tüm kullanıcılara bildirim
    if (analyzed.type === 'transfer' && analyzed.importance === 'high') {
      notifs.broadcastToAll(auth.loadUsers, 'transfer',
        `🔴 Son Dakika Transfer: ${analyzed.player || analyzed.title}`,
        analyzed.summary?.slice(0,100) || '', '/');
      broadcast('breaking_transfer', item);
    }

    res.json({ success: true, data: item });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /admin/comments — Tüm yorumlar
app.get('/admin/comments', auth.requireAuth, requireAdmin, (req, res) => {
  const counts = comments.getAllCommentCounts();
  res.json({ success: true, data: counts });
});

// POST /admin/broadcast — Tüm kullanıcılara bildirim
app.post('/admin/broadcast', auth.requireAuth, requireAdmin, (req, res) => {
  const { title, body, link } = req.body;
  if (!title || !body) return res.status(400).json({ success: false, error: 'title ve body gerekli' });
  notifs.broadcastToAll(auth.loadUsers, 'system', title, body, link || null);
  broadcast('system_broadcast', { title, body });
  res.json({ success: true, message: `${auth.loadUsers().length} kullanıcıya gönderildi` });
});

// ══════════════════════════════════════════════════════════
//  HABER / TRANSFER ROUTE'LARI
// ══════════════════════════════════════════════════════════

// Render disk volume: /var/data  |  Local: ./data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG = {
  maxCachedNews    : 100,
  fetchIntervalMin : 15,
  maxItemsPerFeed  : 8,
  dataFile         : path.join(DATA_DIR, 'news.json'),
};
const FOLLOW_FILE = path.join(DATA_DIR, 'follows.json');


// ── Dil koduna göre RSS kaynakları
const RSS_BY_LANG = {
  tr: [
    { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport', lang: 'en' },
    { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', lang: 'en' },
    { url: 'https://www.espn.com/espn/rss/soccer/news', source: 'ESPN Soccer', lang: 'en' },
  ],
  es: [
    { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport', lang: 'en' },
    { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', lang: 'en' },
  ],
  zh: [
    { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport', lang: 'en' },
    { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', lang: 'en' },
  ],
  ar: [
    { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport', lang: 'en' },
    { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', lang: 'en' },
  ],
  en: [
    { url: 'https://feeds.bbci.co.uk/sport/football/rss.xml', source: 'BBC Sport', lang: 'en' },
    { url: 'https://www.skysports.com/rss/12040', source: 'Sky Sports', lang: 'en' },
    { url: 'https://www.espn.com/espn/rss/soccer/news', source: 'ESPN Soccer', lang: 'en' },
  ],
};
const SUPPORTED_LANGS = ['tr','es','zh','ar','en'];
const FALLBACK_FEEDS  = RSS_BY_LANG.en;
// Geriye uyumluluk (eski kod kullananlar için)
const RSS_FEEDS = RSS_BY_LANG.en;

let newsCache   = [];
let forumTopics = [];

function saveData() {
  try {
    if (!fs.existsSync(path.dirname(CONFIG.dataFile)))
      fs.mkdirSync(path.dirname(CONFIG.dataFile), { recursive: true });
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify({ newsCache, forumTopics }, null, 2));
  } catch (e) { console.error('Kayıt hatası:', e.message); }
}

function loadData() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const d  = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
      newsCache   = d.newsCache   || [];
      forumTopics = d.forumTopics || [];
      console.log(`✅ ${newsCache.length} haber yüklendi`);
    }
  } catch (e) { console.error('Yükleme hatası:', e.message); }
}

const seen = new Set();

// Dil → prompt talimatı
const LANG_PROMPTS = {
  tr: 'Başlık ve özeti TÜRKÇE yaz.',
  es: 'Escribe el título y resumen en ESPAÑOL.',
  zh: '用中文写标题和摘要。',
  ar: 'اكتب العنوان والملخص باللغة العربية.',
  en: 'Write title and summary in ENGLISH.',
};
function analyzeSimple(r, src, lang) {
  const t = r.toLowerCase();
  const isT = /transfer|sign|move|deal|fee|million|loan/i.test(t);
  const isI = /injur|hurt|surgery/i.test(t);
  const isM = /match|goal|score|win|lose/i.test(t);
  const type = isT ? 'transfer' : isI ? 'injury' : isM ? 'match' : 'general';
  return {
    title: r.slice(0, 80).split('\n')[0].trim(),
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
async function analyzeWithClaude(rawText, source, lang = 'en') {
  if (!process.env.ANTHROPIC_API_KEY) return analyzeSimple(rawText, source, lang);
  try {
    const langInstr = LANG_PROMPTS[lang] || LANG_PROMPTS.en;
    const msg = await claude.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 700,
      messages: [{ role: 'user', content:
        'Analyze this sports news article. ' + langInstr + ' Return ONLY valid JSON: {"title":"short title","summary":"2-3 sentence summary","type":"transfer|match|injury|general","importance":"high|medium|low","clubs":[],"player":null,"fee":null,"from_club":null,"to_club":null,"transfer_status":"confirmed|rumor|loan|contract_extension|null","forum_title":"topic title","tags":[],"lang":"' + lang + '"} SOURCE: ' + source + ' TEXT: ' + rawText
      }],
    });
    return JSON.parse(msg.content[0].text.trim().replace(/```json|```/g,'').trim());
  } catch(e) {
    console.error('Claude hatasi:', e.message);
    return analyzeSimple(rawText, source, lang);
  }
}
async function processFeedItem(item, src, lang = 'en') {
  const raw = [item.title, item.contentSnippet].filter(Boolean).join(' ').slice(0, 800);
  if (!raw || raw.length < 30) return null;
  const uid = item.guid || item.link || item.title;
  if (seen.has(uid)) return null;
  try {
    const a = await analyzeWithClaude(raw, src, lang);
    seen.add(uid);
    const n = {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2),
      ...a, source: src, lang: lang, link: item.link||null,
      date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      likes: 0, comments: 0, views: Math.floor(Math.random()*500)+50,
    };
    if (a.type==='transfer' && a.importance==='high') {
      forumTopics.unshift({
        id:n.id+'_t', newsId:n.id, title:a.forum_title||a.title,
        category:'transfer', replies:0, views:0, date:n.date, hot:true, lang,
      });
      forumTopics = forumTopics.slice(0,50);
      notifs.broadcastToAll(auth.loadUsers, 'transfer',
        '🔴 ' + (a.player || a.title),
        (a.summary||'').slice(0,100), '/');
      broadcast('breaking_transfer', n);
    }
    return n;
  } catch { return null; }
}
// NewsAPI ile haber çek
async function fetchFromNewsAPI() {
  if (!process.env.NEWS_API_KEY) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=football+transfer&language=en&sortBy=publishedAt&pageSize=20&apiKey=${process.env.NEWS_API_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!data.articles) return [];
    const results = [];
    for (const a of data.articles) {
      const raw = (a.title || '') + ' ' + (a.description || '');
      const analyzed = analyzeSimple(raw, a.source?.name || 'NewsAPI', 'en');
      results.push({
        id      : Date.now().toString(36) + Math.random().toString(36).slice(2),
        ...analyzed,
        source  : a.source?.name || 'NewsAPI',
        link    : a.url || null,
        date    : a.publishedAt || new Date().toISOString(),
        likes   : 0, comments: 0,
        views   : Math.floor(Math.random() * 500) + 50,
      });
      await new Promise(r => setTimeout(r, 100));
    }
    return results;
  } catch(e) { console.error('NewsAPI hatası:', e.message); return []; }
}
// Tüm diller için RSS çek
async function fetchAndProcess(targetLang = null) {
  const stamp = new Date().toLocaleTimeString('tr-TR');
  console.log(`🔄 RSS [${targetLang || 'all'}] — ${stamp}`);
  let added = 0;
  // Hangi dilleri çekeceğiz?
  const langs = targetLang ? [targetLang] : SUPPORTED_LANGS;
  for (const lang of langs) {
    const feeds = RSS_BY_LANG[lang] || FALLBACK_FEEDS;
    for (const feed of feeds) {
      try {
        const rss = await parser.parseURL(feed.url);
        for (const item of rss.items.slice(0, CONFIG.maxItemsPerFeed)) {
          const r = await processFeedItem(item, feed.source, feed.lang || lang);
          if (r) { newsCache.unshift(r); added++; }
          await new Promise(res => setTimeout(res, 350));
        }
      } catch (e) { console.error(`❌ ${feed.source} [${lang}]:`, e.message); }
    }
  }// NewsAPI'den haber çek
  const apiNews = await fetchFromNewsAPI();
  apiNews.forEach(n => { if(!seen.has(n.id)) { newsCache.unshift(n); added++; seen.add(n.id); } });
  newsCache = newsCache.slice(0, CONFIG.maxCachedNews);
  if (added > 0) { saveData(); console.log(`✅ +${added} haber`); }
}

// ── Ülke kodu → Dil kodu haritası
const COUNTRY_TO_LANG = {
  // Türkçe
  TR:'tr', AZ:'tr', CY:'tr',
  // İspanyolca
  ES:'es', MX:'es', AR:'es', CO:'es', PE:'es', VE:'es', CL:'es', EC:'es',
  GT:'es', CU:'es', BO:'es', DO:'es', HN:'es', PY:'es', SV:'es', NI:'es',
  CR:'es', PA:'es', UY:'es', GQ:'es',
  // Arapça
  SA:'ar', AE:'ar', EG:'ar', IQ:'ar', MA:'ar', DZ:'ar', SD:'ar', SY:'ar',
  YE:'ar', TN:'ar', JO:'ar', LY:'ar', LB:'ar', OM:'ar', KW:'ar', QA:'ar',
  BH:'ar', MR:'ar', SO:'ar', KM:'ar', DJ:'ar', PS:'ar',
  // Çince
  CN:'zh', TW:'zh', HK:'zh', MO:'zh', SG:'zh',
  // Geri kalanlar İngilizce
};

function countryToLang(cc) {
  if (!cc) return 'en';
  return COUNTRY_TO_LANG[cc.toUpperCase()] || 'en';
}

// GET /api/locale?cc=TR  →  {lang, label, dir, feeds}
app.get('/api/locale', (req, res) => {
  const cc   = (req.query.cc || req.query.country || 'US').toUpperCase();
  const lang = countryToLang(cc);
  const meta = {
    tr: { label: 'Türkçe',   flag: '🇹🇷', dir: 'ltr' },
    es: { label: 'Español',  flag: '🌎', dir: 'ltr' },
    zh: { label: '中文',      flag: '🇨🇳', dir: 'ltr' },
    ar: { label: 'العربية',  flag: '🌍', dir: 'rtl' },
    en: { label: 'English',  flag: '🌐', dir: 'ltr' },
  };
  res.json({ success: true, data: { cc, lang, ...meta[lang], sources: (RSS_BY_LANG[lang]||FALLBACK_FEEDS).map(f=>f.source) } });
});

// POST /api/locale/refresh  →  Belirli dil için RSS yenile
app.post('/api/locale/refresh', auth.requireAuth, async (req, res) => {
  const lang = req.body.lang || 'en';
  if (!SUPPORTED_LANGS.includes(lang))
    return res.status(400).json({ success: false, error: 'Desteklenmeyen dil' });
  res.json({ success: true, message: `${lang} için yenileme başlatıldı` });
  fetchAndProcess(lang);
});

// Haber API'leri
app.get('/api/news', auth.optionalAuth, (req, res) => {
  let result = [...newsCache];
  if (req.query.type) result = result.filter(n => n.type === req.query.type);

  // Dil filtresi — lang parametresi gelirse önce o dili öne al
  const lang = req.query.lang;
  if (lang && SUPPORTED_LANGS.includes(lang)) {
    const primary   = result.filter(n => n.lang === lang);
    const secondary = result.filter(n => n.lang !== lang);
    result = [...primary, ...secondary];
  }

  const likedPosts = req.user ? (auth.findUserById(req.user.id)?.likedPosts||[]) : [];
  const counts = comments.getAllCommentCounts();
  const data = result.slice(0, parseInt(req.query.limit)||50).map(n => ({
    ...n,
    isLiked     : likedPosts.includes(n.id),
    commentCount: counts[n.id+'_t'] || 0,
  }));
  res.json({ success: true, count: data.length, data });
});

app.get('/api/transfers', auth.optionalAuth, (req, res) => {
  const likedPosts = req.user ? (auth.findUserById(req.user.id)?.likedPosts||[]) : [];
  const counts = comments.getAllCommentCounts();
  const data = newsCache.filter(n => n.type==='transfer').map(n => ({
    ...n, isLiked: likedPosts.includes(n.id),
    commentCount: counts[n.id+'_t'] || 0,
  }));
  res.json({ success: true, count: data.length, data });
});

app.get('/api/forum/topics', (req, res) => {
  const counts = comments.getAllCommentCounts();
  const data = forumTopics.map(t => ({
    ...t, commentCount: counts[t.id] || 0,
  }));
  res.json({ success: true, count: data.length, data });
});

app.get('/api/stats', (req, res) => {
  const t = newsCache.reduce((a,n) => { a[n.type]=(a[n.type]||0)+1; return a; }, {});
  res.json({ success: true, data: {
    total: newsCache.length, transfers: t.transfer||0,
    matches: t.match||0, topics: forumTopics.length,
    users: auth.loadUsers().length, onlineNow: userSockets.size,
    lastUpdate: newsCache[0]?.date||null,
  }});
});

app.post('/api/analyze', auth.requireAuth, async (req, res) => {
  if (!req.body.text) return res.status(400).json({ success: false, error: 'text gerekli' });
  try {
    res.json({ success: true, data: await analyzeWithClaude(req.body.text, req.body.source||'Manuel') });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/refresh', auth.requireAuth, (req, res) => {
  res.json({ success: true });
  fetchAndProcess();
});


// ══════════════════════════════════════════════════════════
//  ARAMA SİSTEMİ  — Fuse.js fuzzy search + Claude AI özetleme
// ══════════════════════════════════════════════════════════
const Fuse = require('fuse.js');

// Fuse index — her haber eklendiğinde otomatik güncellenir
const FUSE_OPTIONS = {
  includeScore  : true,
  threshold     : 0.38,       // 0=mükemmel, 1=her şey
  ignoreLocation: true,
  minMatchCharLength: 2,
  keys: [
    { name: 'title',       weight: 0.40 },
    { name: 'summary',     weight: 0.20 },
    { name: 'player',      weight: 0.25 },
    { name: 'clubs',       weight: 0.10 },
    { name: 'tags',        weight: 0.05 },
    { name: 'from_club',   weight: 0.05 },
    { name: 'to_club',     weight: 0.05 },
    { name: 'source',      weight: 0.03 },
  ],
};

function buildFuseIndex() {
  const docs = newsCache.map(n => ({
    ...n,
    clubs_str  : (n.clubs || []).join(' '),
    tags_str   : (n.tags  || []).join(' '),
  }));
  return new Fuse(docs, FUSE_OPTIONS);
}

// GET /api/search?q=haaland&type=transfer&lang=tr&limit=20
app.get('/api/search', auth.optionalAuth, async (req, res) => {
  const q     = (req.query.q || '').trim();
  const type  = req.query.type  || null;
  const lang  = req.query.lang  || null;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const ai    = req.query.ai === '1';    // AI özet isteği

  if (!q || q.length < 2)
    return res.status(400).json({ success: false, error: 'En az 2 karakter gir' });

  // 1. Fuse.js fuzzy search
  let pool = [...newsCache];
  if (type) pool = pool.filter(n => n.type === type);
  if (lang) pool = pool.filter(n => n.lang === lang);

  const fuse    = new Fuse(pool, FUSE_OPTIONS);
  const results = fuse.search(q);

  // Sayfalama
  const total  = results.length;
  const start  = (page - 1) * limit;
  const paged  = results.slice(start, start + limit);

  const likedPosts   = req.user ? (auth.findUserById(req.user.id)?.likedPosts || []) : [];
  const commentCounts = comments.getAllCommentCounts();

  const items = paged.map(r => ({
    ...r.item,
    _score      : +(r.score || 0).toFixed(3),
    isLiked     : likedPosts.includes(r.item.id),
    commentCount: commentCounts[r.item.id + '_t'] || 0,
  }));

  // 2. İsteğe bağlı: Claude ile AI özeti
  let aiSummary = null;
  if (ai && items.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      const snippets = items.slice(0, 5)
        .map((n, i) => `${i+1}. ${n.title}: ${n.summary || ''}`)
        .join('\n');
      const lang_name = { tr:'Türkçe', es:'Español', zh:'中文', ar:'العربية', en:'English' }[lang||'en'] || 'English';
      const msg = await claude.messages.create({
        model: 'claude-sonnet-4-20250514', max_tokens: 300,
        messages: [{ role: 'user', content:
          `"${q}" araması için en önemli haberleri 2-3 cümleyle özetle. ${lang_name} dilinde yaz. SADECE özet yaz, başka hiçbir şey yazma.\n\n${snippets}`
        }],
      });
      aiSummary = msg.content[0]?.text?.trim() || null;
    } catch { /* sessizce devam */ }
  }

  // 3. Önerilen aramalar (aynı oyuncu/kulüp)
  const suggestions = [];
  if (items.length > 0) {
    const first = items[0];
    if (first.player && first.player.toLowerCase() !== q.toLowerCase())
      suggestions.push({ label: first.player, type: 'player' });
    (first.clubs || []).slice(0,2).forEach(c => {
      if (c.toLowerCase() !== q.toLowerCase())
        suggestions.push({ label: c, type: 'club' });
    });
  }

  res.json({
    success: true,
    query  : q,
    total,
    page,
    pages  : Math.ceil(total / limit),
    aiSummary,
    suggestions,
    data   : items,
  });
});

// GET /api/search/trending  — Son 24 saat popüler aramalar + hot haberler
app.get('/api/search/trending', (req, res) => {
  const lang = req.query.lang || null;
  let pool = lang ? newsCache.filter(n => n.lang === lang) : newsCache;

  // En çok beğenilen + yüksek öneme sahip haberler
  const trending = [...pool]
    .filter(n => n.importance === 'high' || n.likes > 5)
    .sort((a, b) => (b.likes + b.views * 0.01) - (a.likes + a.views * 0.01))
    .slice(0, 8)
    .map(n => ({ id: n.id, title: n.title, type: n.type, player: n.player, clubs: n.clubs }));

  // Öne çıkan oyuncu/kulüp isimleri (tag bulutu için)
  const playerMap = {};
  const clubMap   = {};
  pool.forEach(n => {
    if (n.player) playerMap[n.player] = (playerMap[n.player] || 0) + 1 + (n.importance==='high'?2:0);
    (n.clubs||[]).forEach(c => { clubMap[c] = (clubMap[c]||0) + 1; });
  });

  const players = Object.entries(playerMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>({ name, count, type:'player' }));
  const clubs   = Object.entries(clubMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>({ name, count, type:'club' }));

  res.json({ success: true, data: { trending, players, clubs } });
});


// ══════════════════════════════════════════════════════════
//  SEO ROUTE'LARI — Sitemap, robots.txt, RSS, OG Image
// ══════════════════════════════════════════════════════════
const SITE_DOMAIN = process.env.SITE_DOMAIN || 'https://goaltransfers.com';

// robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Allow: /api/news
Allow: /api/transfers
Disallow: /admin/
Disallow: /auth/
Disallow: /api/notifications
Disallow: /api/follow

# Sitemap
Sitemap: ${SITE_DOMAIN}/sitemap.xml

# Crawl delay
Crawl-delay: 1`);
});

// Dinamik sitemap.xml
app.get('/sitemap.xml', (req, res) => {
  const now = new Date().toISOString().split('T')[0];
  const staticPages = [
    { loc: '/',              priority: '1.0', freq: 'hourly'  },
    { loc: '/?p=transfers',  priority: '0.9', freq: 'hourly'  },
    { loc: '/?p=forum',      priority: '0.8', freq: 'hourly'  },
    { loc: '/?p=news',       priority: '0.8', freq: 'daily'   },
    { loc: '/?p=search',     priority: '0.6', freq: 'weekly'  },
  ];

  // En önemli transferler için dynamic URL'ler
  const dynamicNews = newsCache
    .filter(n => n.importance === 'high')
    .slice(0, 50)
    .map(n => ({
      loc: `/?p=transfers&id=${n.id}`,
      priority: '0.7',
      freq: 'daily',
      lastmod: n.date?.split('T')[0] || now,
    }));

  const allPages = [...staticPages, ...dynamicNews];
  const urls = allPages.map(p => `
  <url>
    <loc>${SITE_DOMAIN}${p.loc}</loc>
    <lastmod>${p.lastmod || now}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`);
});

// RSS Feed (Google News uyumlu)
app.get('/rss.xml', (req, res) => {
  const lang = req.query.lang || 'tr';
  const items = newsCache
    .filter(n => !lang || n.lang === lang || lang === 'all')
    .slice(0, 30);

  const escXML = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const itemsXML = items.map(n => `
  <item>
    <title>${escXML(n.title)}</title>
    <link>${SITE_DOMAIN}/?p=news&id=${n.id}</link>
    <description>${escXML(n.summary || '')}</description>
    <pubDate>${new Date(n.date).toUTCString()}</pubDate>
    <guid isPermaLink="false">${n.id}</guid>
    <category>${escXML(n.type === 'transfer' ? 'Transfer' : 'Spor')}</category>
    <source url="${SITE_DOMAIN}/rss.xml">GoalTransfer</source>
  </item>`).join('');

  res.type('application/rss+xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>GoalTransfer — Transfer &amp; Spor Haberleri</title>
    <link>${SITE_DOMAIN}</link>
    <description>Son dakika transfer haberleri ve spor gündemleri</description>
    <language>${lang}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_DOMAIN}/rss.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_DOMAIN}/icon-512.png</url>
      <title>GoalTransfer</title>
      <link>${SITE_DOMAIN}</link>
    </image>
    ${itemsXML}
  </channel>
</rss>`);
});

// Google News RSS (özel format)
app.get('/google-news.xml', (req, res) => {
  const items = newsCache.slice(0, 50);
  const escXML = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const itemsXML = items.map(n => `
  <item>
    <title>${escXML(n.title)}</title>
    <link>${SITE_DOMAIN}/?p=news&id=${n.id}</link>
    <description>${escXML(n.summary || '')}</description>
    <pubDate>${new Date(n.date).toUTCString()}</pubDate>
    <guid>${n.id}</guid>
    <news:news>
      <news:publication>
        <news:name>GoalTransfer</news:name>
        <news:language>${n.lang || 'tr'}</news:language>
      </news:publication>
      <news:publication_date>${new Date(n.date).toISOString()}</news:publication_date>
      <news:title>${escXML(n.title)}</news:title>
      <news:keywords>${escXML((n.tags||[]).join(', '))}</news:keywords>
    </news:news>
  </item>`).join('');

  res.type('application/xml; charset=utf-8');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <channel>
    <title>GoalTransfer</title>
    <link>${SITE_DOMAIN}</link>
    ${itemsXML}
  </channel>
</rss>`);
});

// Dinamik OG Image (SVG → PNG proxy için)
app.get('/og-image.png', (req, res) => {
  const title = req.query.title || 'GoalTransfer — Spor Forumu';
  const sub   = req.query.sub   || 'Son Dakika Transfer Haberleri';
  // SVG tabanlı OG image (production'da headless Chrome ile PNG'ye çevir)
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#080c10"/>
      <stop offset="100%" style="stop-color:#0d1a2e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="6" height="630" fill="#00d4ff"/>
  <text x="60" y="120" font-family="Arial Black,sans-serif" font-size="52" font-weight="900" fill="#00d4ff" letter-spacing="4">GOAL TRANSFER</text>
  <text x="60" y="200" font-family="Arial,sans-serif" font-size="36" fill="#e8edf3" font-weight="700">${title.slice(0,50)}</text>
  <text x="60" y="260" font-family="Arial,sans-serif" font-size="24" fill="#8a9bb0">${sub.slice(0,70)}</text>
  <rect x="60" y="310" width="200" height="4" fill="#00ff9d" rx="2"/>
  <text x="60" y="370" font-family="Arial,sans-serif" font-size="20" fill="#8a9bb0">⚽ Transfer Haberleri  💬 Forum  🔍 Arama  🌍 5 Dil</text>
  <text x="1140" y="610" font-family="Arial,sans-serif" font-size="18" fill="#4a5568" text-anchor="end">goaltransfer.onrender.com</text>
  </svg>`;
  res.type('image/svg+xml');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

// Dinamik haber OG image
app.get('/og/news/:id', (req, res) => {
  const item = newsCache.find(n => n.id === req.params.id);
  if(!item) return res.redirect('/og-image.png');
  const title = (item.title || '').slice(0, 55);
  const clubs = item.from_club && item.to_club ? `${item.from_club} → ${item.to_club}` : (item.clubs||[]).slice(0,2).join(' · ');
  const fee   = item.fee || '';
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#080c10"/>
      <stop offset="100%" style="stop-color:#0a1a0a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="6" height="630" fill="#00ff9d"/>
  <rect x="60" y="60" width="160" height="44" fill="rgba(0,255,157,0.1)" rx="6"/>
  <text x="80" y="91" font-family="Arial,sans-serif" font-size="18" fill="#00ff9d" font-weight="700">⚡ SON DAKİKA</text>
  <text x="60" y="200" font-family="Arial Black,sans-serif" font-size="42" font-weight="900" fill="#e8edf3">${title}</text>
  <text x="60" y="290" font-family="Arial,sans-serif" font-size="28" fill="#00ff9d" font-weight="700">${clubs}</text>
  <text x="60" y="340" font-family="Arial Black,sans-serif" font-size="32" fill="#f5c518">${fee}</text>
  <text x="60" y="560" font-family="Arial,sans-serif" font-size="22" fill="#8a9bb0">goaltransfer.onrender.com</text>
  <text x="1140" y="60" font-family="Arial Black,sans-serif" font-size="24" fill="#00d4ff" text-anchor="end" font-weight="900">GOAL TRANSFER</text>
  </svg>`;
  res.type('image/svg+xml');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});

// SEO için haber detay sayfası (bot-friendly HTML)
app.get('/news/:id', (req, res) => {
  const item = newsCache.find(n => n.id === req.params.id);
  if(!item) return res.redirect('/');
  const escHTML = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const schema  = JSON.stringify({
    "@context":"https://schema.org","@type":"NewsArticle",
    "headline":item.title,"description":item.summary||item.title,
    "datePublished":item.date,"dateModified":item.date,
    "author":{"@type":"Organization","name":"GoalTransfer"},
    "publisher":{"@type":"Organization","name":"GoalTransfer","logo":{"@type":"ImageObject","url":SITE_DOMAIN+"/icon-512.png"}},
    "image":SITE_DOMAIN+"/og/news/"+item.id,
    "keywords":(item.tags||[]).join(', ')
  });
  res.send(`<!DOCTYPE html>
<html lang="${item.lang||'tr'}">
<head>
<meta charset="UTF-8">
<title>${escHTML(item.title)} — GoalTransfer</title>
<meta name="description" content="${escHTML(item.summary||item.title)}">
<meta property="og:title" content="${escHTML(item.title)}">
<meta property="og:description" content="${escHTML(item.summary||'')}">
<meta property="og:image" content="${SITE_DOMAIN}/og/news/${item.id}">
<meta property="og:type" content="article">
<meta property="article:published_time" content="${item.date}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${SITE_DOMAIN}/news/${item.id}">
<script type="application/ld+json">${schema}</script>
<meta http-equiv="refresh" content="0;url=/?p=news&id=${item.id}">
</head>
<body>
<h1>${escHTML(item.title)}</h1>
<p>${escHTML(item.summary||'')}</p>
${item.from_club ? `<p><strong>${escHTML(item.from_club)}</strong> → <strong>${escHTML(item.to_club||'')}</strong></p>` : ''}
<p><a href="${SITE_DOMAIN}">GoalTransfer'ya git →</a></p>
</body>
</html>`);
});

// ══════════════════════════════════════════════════════════
//  TAKIM FORUM SİSTEMİ
// ══════════════════════════════════════════════════════════
const FORUM_STRUCTURE = {
  genel: {
    id: 'genel', label: 'Genel', emoji: '💬', color: '#00d4ff',
    description: 'Her konuyu özgürce tartış',
    subcategories: [
      { id: 'transfer-genel',   label: 'Transferler',         emoji: '⚽' },
      { id: 'mac-analiz',       label: 'Maç Analizleri',      emoji: '🏆' },
      { id: 'takim-taktik',     label: 'Taktik & Strateji',   emoji: '📊' },
      { id: 'spor-genel',       label: 'Spor Haberleri',      emoji: '📰' },
    ]
  },
  superlig: {
    id: 'superlig', label: 'Süper Lig', emoji: '🇹🇷', color: '#ff3d00',
    description: 'Süper Lig takımları',
    teams: [
      { id: 'galatasaray',   label: 'Galatasaray',    emoji: '🦁', color: '#f5c518', city: 'İstanbul' },
      { id: 'fenerbahce',    label: 'Fenerbahçe',     emoji: '🦅', color: '#003399', city: 'İstanbul' },
      { id: 'besiktas',      label: 'Beşiktaş',       emoji: '🦅', color: '#1a1a1a', city: 'İstanbul' },
      { id: 'trabzonspor',   label: 'Trabzonspor',    emoji: '⚡', color: '#8b0000', city: 'Trabzon'  },
      { id: 'basaksehir',    label: 'Başakşehir',     emoji: '🔵', color: '#ff8c00', city: 'İstanbul' },
      { id: 'sivasspor',     label: 'Sivasspor',      emoji: '🔴', color: '#cc0000', city: 'Sivas'    },
      { id: 'kasimpasa',     label: 'Kasımpaşa',      emoji: '⚽', color: '#006400', city: 'İstanbul' },
      { id: 'ankaragucu',    label: 'Ankaragücü',     emoji: '⚽', color: '#ff6600', city: 'Ankara'   },
      { id: 'konyaspor',     label: 'Konyaspor',      emoji: '⚽', color: '#006600', city: 'Konya'    },
      { id: 'alanyaspor',    label: 'Alanyaspor',     emoji: '⚽', color: '#ff6600', city: 'Alanya'   },
      { id: 'kayserispor',   label: 'Kayserispor',    emoji: '⚽', color: '#cc0000', city: 'Kayseri'  },
      { id: 'gaziantep',     label: 'Gaziantep FK',   emoji: '⚽', color: '#cc0000', city: 'Gaziantep'},
      { id: 'hatayspor',     label: 'Hatayspor',      emoji: '⚽', color: '#cc6600', city: 'Hatay'    },
      { id: 'rize',          label: 'Çaykur Rizespor',emoji: '⚽', color: '#006600', city: 'Rize'     },
      { id: 'samsunspor',    label: 'Samsunspor',     emoji: '⚽', color: '#cc0000', city: 'Samsun'   },
      { id: 'eyupspor',      label: 'Eyüpspor',       emoji: '⚽', color: '#000080', city: 'İstanbul' },
      { id: 'bodrumspor',    label: 'Bodrumspor',     emoji: '⚽', color: '#0066cc', city: 'Bodrum'   },
      { id: 'goztepe',       label: 'Göztepe',        emoji: '⚽', color: '#ff6600', city: 'İzmir'    },
    ]
  },
  premier: {
    id: 'premier', label: 'Premier Lig', emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', color: '#3d0066',
    description: 'İngiltere Premier Lig',
    teams: [
      { id: 'manchester-city',    label: 'Manchester City',    emoji: '🔵', color: '#6cabdd' },
      { id: 'arsenal',            label: 'Arsenal',            emoji: '🔴', color: '#ef0107' },
      { id: 'liverpool',          label: 'Liverpool',          emoji: '❤️', color: '#c8102e' },
      { id: 'chelsea',            label: 'Chelsea',            emoji: '🔵', color: '#034694' },
      { id: 'manchester-united',  label: 'Manchester United',  emoji: '🔴', color: '#da020d' },
      { id: 'tottenham',          label: 'Tottenham',          emoji: '⚪', color: '#132257' },
      { id: 'newcastle',          label: 'Newcastle United',   emoji: '⚫', color: '#241f20' },
      { id: 'aston-villa',        label: 'Aston Villa',        emoji: '🟣', color: '#95bfe5' },
    ]
  },
  laliga: {
    id: 'laliga', label: 'La Liga', emoji: '🇪🇸', color: '#ee8700',
    description: 'İspanya La Liga',
    teams: [
      { id: 'real-madrid',    label: 'Real Madrid',    emoji: '⚪', color: '#febe10' },
      { id: 'barcelona',      label: 'Barcelona',      emoji: '🔵', color: '#a50044' },
      { id: 'atletico',       label: 'Atlético Madrid',emoji: '🔴', color: '#cb3524' },
      { id: 'sevilla',        label: 'Sevilla',        emoji: '⚪', color: '#d4a843' },
      { id: 'real-sociedad',  label: 'Real Sociedad',  emoji: '🔵', color: '#0067b1' },
      { id: 'villarreal',     label: 'Villarreal',     emoji: '🟡', color: '#009ee0' },
    ]
  },
  bundesliga: {
    id: 'bundesliga', label: 'Bundesliga', emoji: '🇩🇪', color: '#d3010c',
    description: 'Almanya Bundesliga',
    teams: [
      { id: 'bayern',       label: 'Bayern Münih',   emoji: '🔴', color: '#dc052d' },
      { id: 'dortmund',     label: 'Dortmund',       emoji: '🟡', color: '#fde100' },
      { id: 'leverkusen',   label: 'Leverkusen',     emoji: '🔴', color: '#e32221' },
      { id: 'rb-leipzig',   label: 'RB Leipzig',     emoji: '🔴', color: '#dd0741' },
    ]
  },
  seriea: {
    id: 'seriea', label: 'Serie A', emoji: '🇮🇹', color: '#008fd7',
    description: 'İtalya Serie A',
    teams: [
      { id: 'inter',      label: 'Inter Milan',  emoji: '🔵', color: '#0068a8' },
      { id: 'juventus',   label: 'Juventus',     emoji: '⚫', color: '#000000' },
      { id: 'milan',      label: 'AC Milan',     emoji: '🔴', color: '#fb090b' },
      { id: 'napoli',     label: 'Napoli',       emoji: '🔵', color: '#12a0d7' },
      { id: 'roma',       label: 'Roma',         emoji: '🟡', color: '#e3000b' },
    ]
  },
  turnuvalar: {
    id: 'turnuvalar', label: 'Turnuvalar', emoji: '🏆', color: '#f5c518',
    description: 'Uluslararası turnuvalar',
    subcategories: [
      { id: 'sampiyonlar-ligi', label: 'Şampiyonlar Ligi',  emoji: '⭐' },
      { id: 'avrupa-ligi',      label: 'Avrupa Ligi',       emoji: '🟠' },
      { id: 'dunya-kupasi',     label: 'Dünya Kupası',      emoji: '🌍' },
      { id: 'euro',             label: 'Avrupa Şampiyonası',emoji: '🇪🇺' },
    ]
  }
};

// GET /api/forum/categories — Tüm kategori yapısı
app.get('/api/forum/categories', (req, res) => {
  res.json({ success: true, data: FORUM_STRUCTURE });
});

// GET /api/forum/topics/:categoryId — Kategoriye göre konular
app.get('/api/forum/topics/:categoryId', auth.optionalAuth, (req, res) => {
  const catId  = req.params.categoryId;
  const counts = comments.getAllCommentCounts();

  // Tüm konulardan bu kategoriye ait olanları filtrele
  let topics = forumTopics.filter(t => t.category === catId || t.teamId === catId);

  // Yoksa genel haberleri bu kategoriye göre filtrele
  if (!topics.length) {
    const catNews = newsCache.filter(n =>
      (n.clubs || []).some(c => c.toLowerCase().includes(catId.replace(/-/g,' '))) ||
      (n.tags || []).some(t => t.toLowerCase().includes(catId.replace(/-/g,' ')))
    ).slice(0, 10);

    topics = catNews.map(n => ({
      id      : n.id + '_t',
      newsId  : n.id,
      title   : n.forum_title || n.title,
      category: catId,
      teamId  : catId,
      replies : n.comments || 0,
      views   : n.views || 0,
      date    : n.date,
      hot     : n.importance === 'high',
      commentCount: counts[n.id + '_t'] || 0,
    }));
  }

  res.json({ success: true, count: topics.length, data: topics });
});

// POST /api/forum/topics — Yeni konu aç
app.post('/api/forum/topics', auth.requireAuth, (req, res) => {
  const { title, categoryId, teamId, content } = req.body;
  if (!title || !categoryId) return res.status(400).json({ success: false, error: 'title ve categoryId gerekli' });

  const topic = {
    id        : Date.now().toString(36) + Math.random().toString(36).slice(2),
    newsId    : null,
    title     : title.trim(),
    category  : categoryId,
    teamId    : teamId || categoryId,
    content   : (content || '').trim(),
    author    : req.user.username,
    authorId  : req.user.id,
    avatar    : req.user.avatar,
    replies   : 0,
    views     : 0,
    date      : new Date().toISOString(),
    hot       : false,
    pinned    : false,
    commentCount: 0,
  };

  forumTopics.unshift(topic);
  saveData();

  // Socket ile yayınla
  broadcast('new_topic', topic);

  res.json({ success: true, data: topic });
});
// ── BAŞLAT
loadData();
cron.schedule(`*/${CONFIG.fetchIntervalMin} * * * *`, fetchAndProcess);

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║   ⚽ GoalTransfer — http://localhost:${PORT}        ║`);
  console.log('║   Yorumlar + Bildirimler + Admin + Socket.io      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log('Admin için .env\'e ekle: ADMIN_EMAILS=email@site.com\n');
  if (newsCache.length === 0) { console.log('🔄 İlk çekim...'); await fetchAndProcess(); }
});
