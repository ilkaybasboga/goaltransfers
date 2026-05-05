# ⚽ GoalTransfer v3 — Transfer Haberleri & Spor Forumu

Claude AI + Node.js + Socket.io ile tam donanımlı spor forumu.

---

## 🚀 Kurulum (4 Adım)

```bash
# 1. Zip'i aç
unzip goaltransfer-v3.zip && cd goaltransfer

# 2. Paketleri yükle
npm install

# 3. .env oluştur
cp .env.example .env
# → .env dosyasını aç ve API anahtarlarını doldur

# 4. Başlat!
node server.js
# → http://localhost:3000
```

---

## ⚙️ .env Ayarları

| Değişken | Açıklama | Zorunlu |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API anahtarı | ✅ |
| `JWT_SECRET` | Güvenlik anahtarı (rastgele yaz) | ✅ |
| `ADMIN_EMAILS` | Admin e-postalar (virgülle ayır) | ✅ |
| `GOOGLE_CLIENT_ID` | Google OAuth | Opsiyonel |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | Opsiyonel |

---

## 🌐 API Endpoint Listesi

### Auth
| Method | URL | Açıklama |
|---|---|---|
| POST | `/auth/register` | Kayıt |
| POST | `/auth/login` | Giriş |
| POST | `/auth/logout` | Çıkış |
| GET | `/auth/me` | Mevcut kullanıcı |
| PUT | `/auth/profile` | Profil güncelle |
| GET | `/auth/google` | Google OAuth |
| POST | `/auth/like/:id` | Haber beğen |

### Haberler
| Method | URL | Açıklama |
|---|---|---|
| GET | `/api/news` | Tüm haberler |
| GET | `/api/transfers` | Transfer haberleri |
| GET | `/api/forum/topics` | Forum konuları |
| GET | `/api/stats` | İstatistikler |
| POST | `/api/refresh` | RSS yenile |

### Yorumlar
| Method | URL | Açıklama |
|---|---|---|
| GET | `/api/comments/:topicId` | Yorumları getir |
| POST | `/api/comments/:topicId` | Yorum ekle |
| PUT | `/api/comments/:topicId/:id` | Yorum düzenle |
| DELETE | `/api/comments/:topicId/:id` | Yorum sil |
| POST | `/api/comments/:topicId/:id/like` | Yorum beğen |

### Bildirimler
| Method | URL | Açıklama |
|---|---|---|
| GET | `/api/notifications` | Bildirimler |
| PUT | `/api/notifications/read` | Tümünü okundu işaretle |
| PUT | `/api/notifications/:id/read` | Tekil okundu |
| DELETE | `/api/notifications/:id` | Bildirim sil |

### Admin (ADMIN_EMAILS'de kayıtlı e-posta gerekli)
| Method | URL | Açıklama |
|---|---|---|
| GET | `/admin/stats` | Sistem istatistikleri |
| GET | `/admin/users` | Kullanıcı listesi |
| DELETE | `/admin/users/:id` | Kullanıcı sil |
| GET | `/admin/news` | Haber listesi |
| POST | `/admin/news` | Manuel haber ekle |
| DELETE | `/admin/news/:id` | Haber sil |
| POST | `/admin/broadcast` | Toplu bildirim gönder |

---

## 📁 Proje Yapısı

```
goaltransfer/
├── server.js          ← Ana backend (Express + Socket.io)
├── auth.js            ← Kullanıcı sistemi (JWT + Google OAuth)
├── comments.js        ← Forum yorum sistemi
├── notifications.js   ← Bildirim sistemi
├── package.json
├── .env               ← Kendi ayarların (git'e commit etme!)
├── .env.example       ← Örnek .env
├── data/              ← Otomatik oluşturulur
│   ├── news.json
│   ├── users.json
│   ├── comments.json
│   └── notifications.json
└── public/
    └── index.html     ← Forum arayüzü
```

---

## 💰 Maliyet Tahmini

| Kalem | Detay | Aylık Maliyet |
|---|---|---|
| Claude API | ~32 haber/15dk × 96 çekim/gün × $0.001 | ~$3-5 |
| Hosting (Railway) | Free tier (500 saat/ay) | Ücretsiz |
| Hosting (Render) | Free tier | Ücretsiz |

---

## 🌐 Canlıya Alma (Railway)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=sk-ant-...
railway variables set JWT_SECRET=gizli-key
railway variables set ADMIN_EMAILS=admin@site.com
```

---

## 🔌 Socket.io Olayları

| Olay | Yön | Açıklama |
|---|---|---|
| `register` | Client→Server | Kullanıcı kimliğini bildir |
| `new_comment` | Server→Client | Yeni yorum geldi |
| `edit_comment` | Server→Client | Yorum düzenlendi |
| `delete_comment` | Server→Client | Yorum silindi |
| `new_notif` | Server→Client | Yeni bildirim |
| `notif_count` | Server→Client | Okunmamış sayı |
| `breaking_transfer` | Server→All | Son dakika transferi |
| `system_broadcast` | Server→All | Admin duyurusu |
