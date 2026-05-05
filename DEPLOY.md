# 🚀 GoalTransfer — Render'a Deployment Rehberi

## Ön Hazırlık (5 dk)

### 1. GitHub'a yükle
```bash
# Proje klasöründe:
git init
git add .
git commit -m "GoalTransfer v5 - initial"

# GitHub'da yeni repo oluştur: github.com/new
git remote add origin https://github.com/KULLANICI_ADIN/goaltransfer.git
git push -u origin main
```

### 2. Render hesabı aç
→ https://render.com → "Get Started for Free" → GitHub ile giriş yap

---

## Render'da Servis Oluştur (3 dk)

### Adım 1 — New Web Service
Dashboard → **New +** → **Web Service** → GitHub repo'nu seç

### Adım 2 — Temel Ayarlar
| Alan | Değer |
|---|---|
| **Name** | `goaltransfer` |
| **Region** | Frankfurt (EU) — Türkiye'ye yakın |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | `Free` |

### Adım 3 — Disk Volume Ekle
**Advanced** → **Add Disk**
| Alan | Değer |
|---|---|
| **Name** | `goaltransfer-data` |
| **Mount Path** | `/var/data` |
| **Size** | `1 GB` |

### Adım 4 — Environment Variables
**Environment** sekmesi → aşağıdakileri ekle:

```
NODE_ENV          = production
DATA_DIR          = /var/data
PORT              = 3000
ANTHROPIC_API_KEY = sk-ant-api03-...   ← console.anthropic.com
JWT_SECRET        = [güçlü rastgele string — en az 32 karakter]
ADMIN_EMAILS      = senin@emailin.com
```

**JWT_SECRET için rastgele string oluştur:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Adım 5 — Deploy Et
**Create Web Service** → otomatik build başlar → ~3 dk bekle

---

## İlk Deployment Sonrası

### Sitenin URL'si
```
https://goaltransfer.onrender.com
```
(veya seçtiğin isim)

### Sağlık kontrolü
```
https://goaltransfer.onrender.com/api/stats
```
`{"success":true,"data":{...}}` görüyorsan çalışıyor!

### Admin paneline gir
1. Siteye gir → Kayıt ol (`ADMIN_EMAILS`'de yazan e-posta ile)
2. Nav'da **⚙ Admin** butonu görünecek

---

## Google OAuth Kurulumu (isteğe bağlı)

1. https://console.cloud.google.com → **APIs & Services** → **Credentials**
2. **Create Credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Authorized redirect URIs:
   ```
   https://goaltransfer.onrender.com/auth/google/callback
   ```
5. Client ID ve Secret'ı Render'daki Environment Variables'a ekle:
   ```
   GOOGLE_CLIENT_ID     = xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET = GOCSPX-xxxx
   GOOGLE_CALLBACK_URL  = https://goaltransfer.onrender.com/auth/google/callback
   ```
6. Render → **Manual Deploy** → **Deploy latest commit**

---

## Ücretsiz Plan Limitleri

| Limit | Değer | Etkisi |
|---|---|---|
| **Aylık çalışma süresi** | 750 saat | Tüm ay boyunca açık kalır |
| **RAM** | 512 MB | GoalTransfer için yeterli |
| **CPU** | Paylaşımlı | Normal trafikte sorun yok |
| **Disk** | 1 GB | Binlerce haber saklar |
| **Uyku** | 15 dk hareketsizlik | İlk istekte ~30sn gecikme |
| **Bandwidth** | 100 GB/ay | Çok yeterli |

> ⚠️ **Uyku Sorunu:** Ücretsiz planda servis 15 dk kullanılmazsa uyku moduna girer.
> İlk isteği 30 sn beklemek yerine **UptimeRobot** (ücretsiz) ile ping at:
> https://uptimerobot.com → Monitor → HTTP → URL: `https://goaltransfer.onrender.com/api/stats`
> → Every 10 minutes

---

## Güncelleme Nasıl Yapılır?

```bash
# Değişiklikleri GitHub'a gönder
git add .
git commit -m "güncelleme"
git push

# Render otomatik yeniden deploy eder
```

---

## Özel Domain Bağlama (isteğe bağlı)

Render Dashboard → **Settings** → **Custom Domains**
```
goaltransfer.com  →  CNAME  →  goaltransfer.onrender.com
```
SSL otomatik verilir.

---

## Sorun Giderme

| Sorun | Çözüm |
|---|---|
| Build hatası | `npm install` manuel çalıştır, hata mesajını oku |
| `Cannot find module` | `package.json`'daki dependencies'i kontrol et |
| API çalışmıyor | `/api/stats` endpoint'ini tarayıcıda aç |
| Veri kayboldu | Disk volume mount path `/var/data` doğru mu? |
| Google OAuth hata | Callback URL tam eşleşmeli |

---

## Faydalı Komutlar (Render Shell)

Render Dashboard → **Shell** sekmesi:
```bash
# Log'ları gör
cat /var/data/news.json | head -50

# Kullanıcı sayısı
node -e "console.log(JSON.parse(require('fs').readFileSync('/var/data/users.json')).length)"

# Manuel yedek al
cp /var/data/news.json /var/data/news.backup.json
```
