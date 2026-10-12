# Hyper Do

> ADHD dostu kişisel to-do: bir görevi **bitirip işaretleyene kadar** hatırlatmaya devam eder.
> _An ADHD-friendly personal to-do app that keeps nagging you until you actually mark the task done._

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android%20%7C%20PWA-ff8a3d)
![Stack](https://img.shields.io/badge/stack-React%2019%20%C2%B7%20TypeScript%20%C2%B7%20Vite%20%C2%B7%20Electron%20%C2%B7%20Capacitor-0f1117)
![Languages](https://img.shields.io/badge/i18n-TR%20%7C%20EN%20%7C%20RU-4c9aff)
![Privacy](https://img.shields.io/badge/data-only%20on%20your%20device-2ea043)

Hesap yok, bulut yok, abonelik yok. Veriler sadece cihazında durur.

---

## İçindekiler

- [Neden Hyper Do?](#neden-hyper-do)
- [Özellikler](#özellikler)
- [Platformlar](#platformlar)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Doğal dilli hızlı ekleme](#doğal-dilli-hızlı-ekleme)
- [Telegram botu](#telegram-botu-windowsmacos)
- [Android derleme](#android-derleme)
- [Geliştirme](#geliştirme)
- [Proje yapısı](#proje-yapısı)
- [Veri ve gizlilik](#veri-ve-gizlilik)

---

## Neden Hyper Do?

Klasik to-do uygulamaları bir kez bildirir ve susar. Hyper Do susmaz: görevi tamamlayıp işaretlemediğin sürece, seçtiğin aralıkla hatırlatmayı sürdürür. Son tarih geçtiyse aralığı yarıya indirir. Pencereyi kapatsan da tepsiden, telefonun kilitliyken de yerel bildirimle, istersen Telegram'dan da ulaşır.

## Özellikler

- 🔔 **Bitene kadar hatırlat** — her görev için ayrı aralık (5 dk … 2 sa). Son tarih geçtiyse aralık yarıya iner.
- 😏 **Eğlenceli başlıklar** — "Yine unuttun dimi?", "Tık tık…", "Forgot again, didn't you?" gibi rastgele başlıklar (ayarlardan kapatılabilir).
- 🎯 **Odak modu** — tek bir görevi en üste sabitle, sıradaki alt adımı gör.
- 📋 **Görev ayrıntıları** — öncelik (yüksek/orta/düşük), etiketler, son tarih, alt görevler, tekrarlayan görevler (günlük, hafta içi, haftalık, aylık).
- 🗂️ **Pano (Kanban)** — Yapılacak / Yapılıyor / Bekliyor / Bitti sütunları; kartları sürükleyerek sütun ve sıra değiştir, "Bitti"ye bırakmak görevi tamamlar. Her sütunun altından hızlı ekleme.
- ⚡ **Doğal dilli hızlı ekleme** — `yarın 18:00 fatura öde #ev !1 @30dk` → tarih, saat, etiket, öncelik ve hatırlatma aralığı otomatik ayrışır; yazarken önizleme görünür.
- 🔍 **Arama ve sıralama** — arama (`/`), sıralama (akıllı, son tarih, öncelik, yeni, A→Z, elle), listede sürükleyerek elle sıralama.
- ↶ **Pişmanlık yok** — silmeyi geri al, görevi kopyala, yarına ertele, bitenleri topluca temizle, "bugün N bitti" sayacı.
- ⌨️ **Kısayollar** — `N` yeni görev, `/` ara, `1-5` görünüm değiştir, `Esc` kapat.
- 🔕 **Sustur** — 15 dk / 30 dk / 1 sa / 3 sa; ayrıca sessiz saatler.
- 📲 **Telegram botu** — hatırlatmalar telefonuna Telegram'dan da gelir; mesajın altındaki düğmelerle "Bitirdim / 30 dk sustur / Odak" diyebilir, bota düz yazarak görev ekleyebilirsin.
- 🌗 **Tema** — koyu / açık / sistem.
- 💾 **Yedek** — JSON dışa/içe aktarma.
- 🌍 **Diller** — Türkçe / English / Русский.

## Platformlar

| Platform | Nasıl | Hatırlatma davranışı |
|---|---|---|
| Windows (Electron) | `npm run dist` → `Hyper Do Setup x.y.z.exe` kur; masaüstü ve Başlat kısayolu kendiliğinden oluşur | Pencere kapalıyken bile tepsiden hatırlatır, görev çubuğunda yanıp söner |
| macOS (Electron) | `npm run dist:mac` (bir Mac'te çalıştırılmalı) | Dock'ta kalır, pencere kapalıyken bildirir |
| Android (Capacitor) | `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk` | Uygulama kapalıyken de bildirir: hatırlatmalar 48 saat ileriye yerel bildirim olarak planlanır, uygulama her açılışta plan uzatılır |
| Web / iPhone / iPad (PWA) | `npm run dev:web` veya `dist-web` klasörünü yayınla | Sadece sekme ya da ana ekrana eklenmiş uygulama **açıkken** bildirir |

**iPhone'da:** Safari'de siteyi aç → Paylaş → **Ana Ekrana Ekle**. Bildirim izni ancak ana ekrandan açılan uygulamada istenebilir (iOS 16.4+).

## Hızlı başlangıç

```bash
git clone https://github.com/leozencreates/hyper-do.git
cd hyper-do
npm install
npm run dev        # Electron + Vite, sıcak yenileme
```

Sadece tarayıcıda denemek için:

```bash
npm run dev:web    # http://localhost:5180 — aynı ağdaki telefon da erişebilir
```

## Doğal dilli hızlı ekleme

Tek satır yaz, gerisini Hyper Do ayrıştırır:

```
yarın 18:00 fatura öde #ev !1 @30dk
```

| Parça | Anlamı |
|---|---|
| `bugün`, `yarın`, `cuma`, `15.10` | Son tarih (gün adları ve `gg.aa` biçimi desteklenir) |
| `18:00` | Saat |
| `#ev` | Etiket (birden fazla olabilir) |
| `!1` / `!2` / `!3` | Öncelik: yüksek / orta / düşük |
| `@30dk`, `@2sa` | Hatırlatma aralığı |

Anahtar kelimeler Türkçe, İngilizce ve Rusça çalışır; yazarken ayrışan parçalar önizlemede görünür.

## Telegram botu (Windows/macOS)

1. Telegram'da **@BotFather**'a `/newbot` yaz, bir ad ver; verdiği token'ı kopyala.
2. Hyper Do → Ayarlar → **Telegram botu**'nu aç, token'ı yapıştır.
3. Telegram'da kendi botunu aç ve `/start` yaz. Bağlantı otomatik kurulur; ilk `/start` yazan sohbet sahip olur, diğerleri yoksayılır.
4. Uygulama (ya da tepsi simgesi) açık olduğu sürece hatırlatmalar hem masaüstü bildirimi hem Telegram mesajı olarak gelir.

| Komut | İşlev |
|---|---|
| `/list` | Açık görevleri listele |
| `/done N` | N numaralı görevi bitir |
| `/snooze N [dk]` | N numaralı görevi sustur (varsayılan süre ayarlardan) |
| `/focus N` | N numaralı görevi odağa al |
| `/add metin` | Görev ekle (düz yazmak da yeter, hızlı ekleme sözdizimi geçerlidir) |
| `/help` | Yardım |

Token yalnızca cihazındaki veri dosyasında saklanır; hiçbir sunucuya gönderilmez.

## Android derleme

Gereksinimler:

- Android SDK (`%LOCALAPPDATA%\Android\Sdk`, platform 36)
- JDK 21 — `.tools/jdk-21*` altında taşınabilir kopya; `android/gradle.properties` içindeki `org.gradle.java.home` oraya bakar

```bash
npm run android:sync   # web derle + Android projesine kopyala
npm run android:apk    # debug APK üret
npm run android:open   # Android Studio'da aç (kuruluysa)
npm run android:run    # bağlı cihaza yükle ve çalıştır
```

APK'yı telefona atıp kur. İlk açılışta bildirim izni ister. **Ayarlar → Pil → Hyper Do → "Kısıtlama yok"** seçmen hatırlatmaların gecikmemesi için önemlidir.

## Geliştirme

```bash
npm install
npm run dev          # Electron + Vite, sıcak yenileme
npm run dev:web      # Sadece tarayıcı, http://localhost:5180
npm run build        # Electron için derle (dist/ + dist-electron/)
npm run build:web    # PWA için derle (dist-web/)
npm run preview:web  # dist-web'i yerelde önizle
npm run dist         # Windows kurulum paketi → %LOCALAPPDATA%\hyperdo-release\
npm run dist:mac     # macOS DMG (Mac'te)
npm run android:apk  # Android debug APK
```

> `npm run dist` çıktıyı Desktop yerine `%LOCALAPPDATA%\hyperdo-release\` altına yazar; Desktop altında klasör adlandırma kısıtı buna sebep olur.

Teknolojiler: React 19, TypeScript, Vite, Electron, electron-builder, Capacitor (Android), Web Notifications + Service Worker (PWA).

## Proje yapısı

```
electron/main.ts               Ana süreç: pencere, tepsi, bildirimler, hatırlatma zamanlayıcısı, JSON depolama
electron/telegram.ts           Telegram botu: long-polling komutlar, düğmeli hatırlatmalar
electron/preload.ts            Güvenli IPC köprüsü (window.tidi)
src/lib/reminder.ts            Platformdan bağımsız hatırlatma motoru (Electron ve web ortak)
src/lib/tasks.ts               Saf görev yardımcıları (ekle, bitir, sırala, sürükle-bırak, kopyala, normalize)
src/lib/parse.ts               Doğal dilli hızlı ekleme ayrıştırıcısı
src/lib/dates.ts               Tarih yardımcıları (bugün, bu hafta, gecikmiş)
src/lib/store.ts               Uygulama durumu ve kalıcılık
src/lib/types.ts               Görev / ayar tipleri ve varsayılanlar
src/lib/platform.ts            Electron / Capacitor (Android) / Web uyarlamasından uygununu seçer
src/lib/platform.capacitor.ts  Android: yerel bildirimleri 48 saat ileriye planlar
src/lib/platform.web.ts        Tarayıcı: localStorage + Web Notification
src/lib/i18n.ts                TR / EN / RU metinler ve eğlenceli başlık havuzu
src/components/Board.tsx       Kanban panosu (sürükle-bırak)
src/components/QuickAdd.tsx    Hızlı ekleme kutusu ve önizleme
src/components/TaskItem.tsx    Liste satırı
src/components/TaskEditor.tsx  Görev düzenleme paneli
src/components/FocusBanner.tsx Odak modu şeridi
src/components/SettingsPanel.tsx  Ayarlar
src/App.tsx                    Arayüz
public/sw.js                   PWA service worker (çevrimdışı + bildirim tıklaması)
android/                       Capacitor Android projesi
```

## Veri ve gizlilik

| Ortam | Depolama |
|---|---|
| Electron (Windows/macOS) | `%APPDATA%/hyper-do/hyperdo-data.json` |
| Android | Capacitor Preferences (uygulama sandbox'ı) |
| Web / PWA | Tarayıcı `localStorage` |

Hesap, telemetri veya uzak sunucu yoktur. Tek dış bağlantı, **sen açarsan** Telegram Bot API'dir. Yedek almak için Ayarlar → JSON dışa aktar.
