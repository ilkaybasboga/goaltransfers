# 🏆 GoalTransfer — SEO & Gelir Modeli Rehberi

---

## 📊 MEVCUT SEO ALTYAPISI

### Teknik SEO (Otomatik)
| Özellik | URL | Durum |
|---|---|---|
| robots.txt | `/robots.txt` | ✅ Aktif |
| Sitemap | `/sitemap.xml` | ✅ Dinamik (her haber için) |
| RSS Feed | `/rss.xml?lang=tr` | ✅ Google News uyumlu |
| Google News RSS | `/google-news.xml` | ✅ Aktif |
| OG Image | `/og-image.png` | ✅ Dinamik SVG |
| Haber OG | `/og/news/:id` | ✅ Her haber için özel |
| SEO Haber Sayfası | `/news/:id` | ✅ Bot-friendly HTML |
| Hreflang | HTML head | ✅ 5 dil |
| JSON-LD Schema | HTML head | ✅ WebSite + NewsOrg + Article |
| Canonical URL | Her sayfa | ✅ Dinamik |
| Twitter Cards | HTML head | ✅ summary_large_image |

---

## 🚀 GOOGLE'DA ÜST SIRA İÇİN ADIMLAR

### 1. Google Search Console (ZORUNLU — Ücretsiz)
```
1. search.google.com/search-console → Ekle
2. Domain doğrula (DNS veya HTML dosyası)
3. Sitemap gönder: https://goaltransfer.onrender.com/sitemap.xml
4. URL Inspection → Index İste → Ana sayfa
```
**Etki süresi:** 1-4 hafta

### 2. Google News'e Başvur (Organik trafik patlaması)
```
1. https://publishercenter.google.com
2. "Add Publication" → GoalTransfer
3. RSS: https://goaltransfer.onrender.com/google-news.xml
4. Dil: Türkçe + İngilizce
5. Kategori: Sports
```
Google News'e girince her transfer haberin Google aramalarında **haber kutusunda** çıkar.
**Etki süresi:** 2-8 hafta onay süreci

### 3. Bing Webmaster Tools (Ücretsiz, %30 ekstra trafik)
```
https://www.bing.com/webmasters → Sitemap gönder
```

### 4. Uzun Kuyruk Anahtar Kelimeler (İçerik Stratejisi)
```
❌ "transfer haberleri"      (çok rekabetli)
✅ "isak chelsea transfer"   (oyuncu+kulüp+kelime)
✅ "fenerbahçe yeni transfer 2025"
✅ "süper lig transfer haberleri son dakika"
✅ "Haaland sakatlık ne zaman dönecek"
```
→ Claude AI zaten başlıkları bu formatta üretiyor ✅

### 5. Schema Markup Kontrol
```
https://search.google.com/test/rich-results
URL: https://goaltransfer.onrender.com
→ NewsArticle, WebSite, SearchAction görünmeli
```

### 6. Sayfa Hızı (Core Web Vitals)
```
https://pagespeed.web.dev → URL gir
Hedef: LCP < 2.5s, FID < 100ms, CLS < 0.1
```
Şu an zaten hızlı — statik HTML + CDN font.

---

## 💰 GELİR MODELLERİ

### 1. Google AdSense (En Hızlı Gelir)
**Başvuru şartları:** 18 yaş, gerçek içerik, 6+ ay alan adı (önerilir)

```
1. https://adsense.google.com → Başvur
2. Hesabı site.html'e ekle:
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX"></script>
3. Otomatik Reklam aktif et
4. ads.txt güncelle: google.com, pub-XXXX, DIRECT, f08c47fec0942fa0
```

**Gelir tahmini:**
| Aylık Ziyaretçi | Tahmini Gelir |
|---|---|
| 5.000 | $10-30 |
| 20.000 | $50-150 |
| 100.000 | $300-800 |
| 500.000 | $2.000-5.000 |

**En iyi reklam yerleri (sitede hazır):**
- `#ad-top` — 728x90 header banner (CTR: %0.5-2)
- `#ad-sidebar` — 300x250 sidebar (CTR: %1-3)
- `.ad-in-feed` — In-feed (CTR: %2-5, en yüksek)

---

### 2. Affiliate Marketing (Spor Bahis Siteleri)
Spor sitelerinde en yüksek komisyon.

| Platform | Komisyon | Türkiye'de |
|---|---|---|
| Bet365 Affiliate | $200-500/kayıt | ✅ |
| Betsson | %25-35 gelir payı | ✅ |
| William Hill | $100-300/kayıt | ✅ |
| Bilyoner | %10-20 komisyon | ✅ TR |

**Nasıl entegre edilir:**
```html
<!-- Transfer haberlerinin altına -->
<div class="sponsored-tag">Sponsorlu</div>
<a href="AFFILIATE_LINK">
  Bu transferi tahmin et → Bahis yap
</a>
```

**Gelir tahmini:** 100.000 ziyaretçide $500-2.000/ay

---

### 3. Direkt Reklam (Spor Markaları)
Forum yeterince büyüyünce spor markaları doğrudan başvurur.

**Hedef markalar:** Nike, Adidas, Puma, spor kanalları, TV platformları

**Fiyatlandırma:**
| Reklam Türü | Fiyat/Ay |
|---|---|
| Sidebar banner | $50-500 |
| Header banner | $100-1.000 |
| Newsletter sponsorluğu | $50-300 |
| Özel içerik (yazı) | $100-500 |

---

### 4. Premium Üyelik (Gelecek Aşama)
Kod hazır, stripe entegrasyonu eklenebilir.

| Plan | Fiyat | Özellikler |
|---|---|---|
| Free | $0 | Reklamlı, temel özellikler |
| Pro | $4.99/ay | Reklamsız, anlık bildirim, takip limiti ↑ |
| Club | $9.99/ay | Tüm özellikler + özel analiz raporları |

**Stripe entegrasyonu:** `npm install stripe` + 1 endpoint

---

### 5. Sosyal Medya → Trafik Artırma
Her transfer haberini otomatik tweet et:

```javascript
// server.js'e eklenecek (Twitter API v2)
const { TwitterApi } = require('twitter-api-v2');
const twitterClient = new TwitterApi(process.env.TWITTER_BEARER);

// fetchAndProcess içinde:
if(a.type==='transfer' && a.importance==='high') {
  twitterClient.v2.tweet(
    `🔴 ${a.title}\n${a.from_club} → ${a.to_club} | ${a.fee||''}\n#transfer #futbol\n${SITE_DOMAIN}/news/${n.id}`
  );
}
```

---

## 📈 6 AYLIK BÜYÜME PLANI

### Ay 1-2: Temel
- [ ] Google Search Console'a ekle, sitemap gönder
- [ ] Google News'e başvur
- [ ] Bing Webmaster'a ekle
- [ ] AdSense başvurusu yap

### Ay 3-4: İçerik
- [ ] Günde 20+ transfer haberi (Claude zaten yapıyor ✅)
- [ ] Her büyük transfer için detaylı analiz sayfası
- [ ] Twitter/X hesabı aç, otomatik paylaşım kur
- [ ] Google News onayı → Trafik patlaması

### Ay 5-6: Gelir
- [ ] AdSense aktif → İlk gelirler
- [ ] Bahis affiliate anlaşmaları
- [ ] 50.000+ aylık ziyaretçi → Direkt reklam müzakereleri
- [ ] Premium üyelik lansmanı

---

## 🛠 HIZLI KONTROL LİSTESİ

Deploy sonrası ilk yapılacaklar:
```
□ https://goaltransfer.onrender.com/robots.txt  → İçerik var mı?
□ https://goaltransfer.onrender.com/sitemap.xml → URL'ler var mı?
□ https://goaltransfer.onrender.com/rss.xml     → Haberler var mı?
□ Google Search Console'a ekle → Sitemap gönder
□ https://search.google.com/test/rich-results → Schema test
□ https://pagespeed.web.dev                   → Hız test
□ AdSense başvurusu yap
```
