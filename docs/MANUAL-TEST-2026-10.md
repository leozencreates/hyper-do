# Hyper Do 0.2.0 — elle test planı (Ekim 2026)

Otomatik testler (`npm test`, 20 dosya / 431 test) saf mantığı kapsıyor; bu belge Vitest'in göremediği her şeyi
kapsar: Electron pencereleri, Windows bildirimleri, gerçek Telegram API'si ve Mini App (tünel, telefon), Android,
tarayıcı ve iki cihaz arası eşitleme. Her bölümde **en riskli maddeler en üstte**. Her maddenin başında, başarısız olursa bakılacak dosya var.

Nasıl kullanılır:

- Adımları sırayla uygula; her adımın altındaki **→** satırı beklenen sonuçtur. Sonuç farklıysa maddenin başındaki
  dosyadan başla.
- Uygulama dili **Türkçe** varsayıldı (Ayarlar → Dil). Beklenen metinler `src/lib/i18n.ts` içindeki TR tablosundan
  alındı; dil İngilizce ise karşılıkları aynı tabloda.
- *Geliştirme* = `npm run dev`. *Kurulu sürüm* = `npm run dist` ile üretilen `Hyper-Do-Setup-0.2.0.exe` kurulduktan
  sonra. Bazı maddeler yalnızca kurulu sürümde çalışır (oturum açınca başlat, güncelleyici, kalıcı `hyperdo://`
  kaydı); bunlar işaretli.
- Veri dosyaları: Windows `%APPDATA%\hyper-do\hyperdo-data.json` (+ `backups\`, `hyperdo-state.json`,
  `hyperdo-sync.json`, `hyperdo-calendar.json`, `window-state.json`). Sıfırdan başlamak için uygulamayı kapatıp
  bu klasörü yeniden adlandır.
- Hatırlatma motoru 30 saniyede bir çalışır; "hemen" = en geç 30 s. Yeni görevin **ilk** hatırlatması hemen gelir,
  sonrakiler aralık kadar bekler.

İçindekiler: [A. Windows masaüstü](#a-windows-masaüstü) · [B. Telegram](#b-telegram) · [C. Android](#c-android) ·
[D. Web / PWA](#d-web--pwa) · [E. Senkron (iki cihaz)](#e-senkron-iki-cihaz)

---

## A. Windows masaüstü

### A1. Bildirim düğmeleri ve `hyperdo://` protokolü  (📁 `electron/main.ts` → `handleDeepLink`, `notify`; `src/lib/deeplink.ts`)

En riskli madde: Windows'un `toastXml`'i kabul etmesi ve `launch` bağlantısının ikinci örneğe ulaşması hiç
çalıştırılmadı.

1. Yeni görev: `toast testi @5dk`. Pencereyi küçült.
   → 30 s içinde bir Windows bildirimi gelir; altında **✓ Bitirdim · 😴 30 dk · Aç** düğmeleri var. Düğme yoksa
   `toastXml` reddedilmiş demektir; konsolda `[notify] toastXml failed, falling back:` satırı aranır (yedek düz
   bildirime düşer).
2. **✓ Bitirdim**'e tıkla, pencereyi açma.
   → Görev Bitti'ye geçer, pencere öne gelmez. Sol altta "bugün N bitti" sayacı artar. Telegram bağlıysa oradaki
   mesaj üstü çizili olur (B2).
3. Yeni görev `snooze testi @5dk`; bildirimde **😴 30 dk**.
   → Görev satırında 30 dk sonrasına ertelendiği görünür, 30 dk boyunca yeni bildirim gelmez; 👀 sayacı (varsa)
   sıfırlanır.
4. Üçüncü görevde **Aç**.
   → Ana pencere öne gelir ve görev vurgulanır (listede kaymış/parlıyor).
5. Uygulama açıkken Çalıştır (Win+R): `hyperdo://task/<görev-id>/done` (id'yi `hyperdo-data.json` içinden al).
   → "İkinci örnek" ana sürece bağlantıyı iletir, görev bitirilir, yeni pencere açılmaz.
6. Tepsi → Çıkış ile tamamen kapat, aynı URL'yi çalıştır. *(kurulu sürüm)*
   → Uygulama başlar ve görevi bitirir. Geliştirme modunda protokol `electron.exe + proje klasörü` ile kayıtlıdır;
   çalışmazsa kurulu sürümde dene.
7. `hyperdo://task/<id>/snooze/45` → 45 dk ertelenir. `hyperdo://task/yok/done` → hiçbir şey olmaz, hata yok.
8. Başlığı `A & B <c> "d"` olan görev oluştur, bildirimi bekle.
   → Bildirim gelir ve başlık doğru görünür (XML kaçışı). Gelmezse `reminderToastXml`'deki kaçış bozuk.

### A2. Hızlı ekleme penceresi (popup) ve odak davranışı  (📁 `electron/quick.ts` — `blur` 400 ms koruması; `src/components/QuickCapture.tsx`)

1. Başka bir uygulama (tarayıcı) tam ekranken `Ctrl+Shift+Space`.
   → Faresinin olduğu ekranda, ortanın biraz üstünde 560×120 çerçevesiz kutu; imleç giriş alanında, alan boş.
2. Hiçbir şey yapmadan 5 s bekle.
   → Kutu açık kalır. Hemen kapanıyorsa Windows `show()` sonrası sahte `blur` üretmiştir; 400 ms koruması yetmemiş.
3. `yarın 18:00 fatura #ev !1 @30dk` yaz.
   → Canlı önizleme çipleri: tarih, etiket, öncelik, aralık.
4. Enter.
   → Kutu 2 s "✓ Eklendi: fatura" gösterip kapanır; ana pencerede görev hemen görünür (ana süreç yayını).
5. Tekrar aç, Esc → kapanır. Tekrar aç, başka pencereye tıkla → kapanır (blur).
6. Çok satırlı metin yapıştır (3 satır) → önizleme "3 görev", Enter → 3 görev.
7. Tepsi menüsü → **Hızlı ekle…** → aynı kutu açılır.
8. Ayarlar → Masaüstü → Hızlı ekleme kısayolu: `Foo+Bar` yaz, alandan çık.
   → Kırmızı satır: "Foo+Bar kaydedilemedi: …". Alanı boşalt → "Kısayol kapalı", kısayol çalışmaz. **Sıfırla** →
   "Etkin: CommandOrControl+Shift+Space".
9. Başka bir uygulamanın kullandığı kısayolu gir (ör. `Ctrl+Shift+Esc`).
   → "… kaydedilemedi: başka bir uygulama kullanıyor ya da geçersiz".

### A3. Oturum açınca başlat *(kurulu sürüm)*  (📁 `electron/main.ts` → `applyLoginItem`; yalnız `app.isPackaged`)

1. Ayarlar → Masaüstü → **Oturum açınca başlat** aç.
   → Görev Yöneticisi → Başlangıç uygulamaları listesinde "Hyper Do" belirir.
2. Oturumu kapat / aç (veya yeniden başlat).
   → Uygulama **penceresiz**, yalnız tepsi simgesiyle başlar (`--hidden`); tepsi → Aç ile pencere gelir.
   Hatırlatmalar pencere açılmadan da çalışır (A1 adım 1'i tekrarla).
3. Anahtarı kapat → Başlangıç listesinden kalkar.
4. Geliştirme modunda anahtarı aç → hiçbir şey olmaz (bilerek: çıplak `electron.exe` kayda girmesin).

### A4. Mini pencere  (📁 `electron/mini.ts`, `src/components/MiniView.tsx`, `src/components/HyperFocus.tsx` — `driver: false`)

1. Ana pencerede `M`.
   → Sağ altta 340×150 çerçevesiz kart; tepsi menüsünde "Mini pencere" işaretli; Ayarlar → Masaüstü → Mini pencere
   anahtarı açık.
2. Başka bir uygulamayı tam ekran yap → kart üstte kalır. Kartı arka planından sürükle → taşınır; düğmelerden
   sürüklenmez.
3. Odak görevi yokken → "odak görevi yok" metni. Bir görevi odağa al → başlığı ve ilk açık alt görevi görünür.
4. Hyper Focus başlat → kartta halka + geri sayım. **⚡** durdur/sürdür, **😴 30** erteler, **✓** bitirir
   (konfeti mini pencerede **çıkmaz**), **↗** ana pencereyi öne getirir.
5. Çalışma süresini 1 dk yap, iki pencere açıkken bir tur bitir.
   → Tek bir melodi, tek faz geçişi; mola 1 kez başlar (iki pencere aynı seansı iki kez ilerletmemeli).
6. Ana pencereyi kapat (tepsiye) → mini açık kalır. Mini'yi taşı, uygulamayı tamamen kapatıp aç, `M`.
   → Aynı konumda açılır (`window-state.json`). Ekran bağlantısını değiştirip konum ekran dışında kalırsa sağ alta
   döner.
7. `M` tekrar → kapanır; tepsi işareti ve Ayarlar anahtarı kalkar.

### A5. Tırmanma merdiveni  (📁 `src/lib/reminder.ts` → `markNagged`/`escalationLevel`; `electron/main.ts` → `tick`; `src/components/TaskItem.tsx`)

Hızlı test için eşikleri düşür: Ayarlar → Tırmanma merdiveni → "Uyarı satırı şundan sonra" **2**, "Mini pencere
şundan sonra" **3**.

1. Görev `merdiven @5dk`, hiçbir bildirime dokunma.
   → 1. bildirim normal. 2. bildirimden sonra görev satırında **👀 ×2** çipi; 3. bildirimin **gövdesi**
   "👀 2 kez görmezden geldin — hâlâ bitmedi mi?" ile başlar.
2. 4. bildirimde (sayaç 3):
   → Mini pencere kendiliğinden açılır ve görevi gösterir; bildirim "kritik" (Windows'ta odak yardımcısını deler).
   Çip titrer.
3. Görevi 30 dk ertele.
   → Çip kaybolur (sayaç 0). Aynı şey: bitir, yarına at, odağa al, düzenleyip kaydet, bildirim/Telegram düğmesi.
4. Sessiz saatler açıkken veya `/mute` ile susturulmuşken bekle → sayaç artmaz (teslim edilmeyen hatırlatma sayılmaz).
5. Anahtarı kapat → çip ve satır yok, mini pencere açılmaz.

### A6. Kutlama  (📁 `src/components/Celebration.tsx`, `src/App.tsx` → `useCelebration`; `src/lib/sound.ts`)

1. Bir görevin kutusunu işaretle.
   → İki notalı kısa melodi + ~1 s konfeti (24 parça).
2. Pano'da bir kartı **Bitti** sütununa bırak → aynı kutlama.
3. Ayarlar → **Bitirince kutla** kapalı → ne ses ne konfeti.
4. Windows → Erişilebilirlik → Animasyon efektleri kapalı (`prefers-reduced-motion`) → melodi var, konfeti yok.
5. Mini pencereden veya hızlı ekleme penceresinden bitirme → konfeti yalnız ana pencerede; melodi mini pencereden de çalar (A13).
6. Ayarlar → **Ses efektleri** kapalı, **Bitirince kutla** açık → konfeti var, melodi yok.

### A7. Sabah özeti ve akşam değerlendirmesi  (📁 `src/lib/digest.ts` → `digestDue`; `electron/main.ts` → `checkDigest`; durum `hyperdo-state.json`)

1. Ayarlar → **Sabah özeti** saatini şu andan 1 dk sonrasına al; 2 gecikmiş, 1 bugünlük görev olsun.
   → Saat gelince bildirim "☀️ Günaydın": gecikmiş / bugün / açık sayıları, 🔥 seri ve ilk 3 görev. Telegram
   bağlıysa aynı mesaj 1-2-3 numara düğmeleriyle (B6).
2. Uygulamayı kapatıp aç.
   → Özet **tekrar gelmez** (`hyperdo-state.json` içinde `lastDigestAt` bugünün tarihi).
3. Saati 2 saat öncesine al, uygulamayı yeniden başlat (durum dosyasındaki `lastDigestAt`'i sil).
   → Hemen gelir (12 saatlik tolerans). 13 saat öncesine alırsan gelmez.
4. **Akşam değerlendirmesi** aç, saati 1 dk sonraya al.
   → "🌙 Akşam değerlendirmesi": bugün biten N · bugün için açık M. Pazar günüyse başlık "📊 Haftalık değerlendirme".
5. Hem sabah hem akşam beklemedeyken → önce sabah, akşam bir sonraki kontrolde.

### A8. Otomatik günlük yedek  (📁 `electron/main.ts` → `maybeBackup`, `backupInfo`)

1. Günün ilk değişikliğini yap (bir görev ekle).
   → `%APPDATA%\hyper-do\backups\hyperdo-data-YYYY-MM-DD.json` oluşur; Ayarlar → Otomatik günlük yedek altında
   "Son otomatik yedek: <tarih saat>" ve **Klasörü aç** klasörü açar.
2. Aynı gün ikinci değişiklik → yeni dosya yok (günde bir).
3. Klasöre elle 8 adet eski adlı dosya koy (`hyperdo-data-2026-01-0X.json`), bir değişiklik yap.
   → En yeni 7 kalır, en eskiler silinir.
4. Anahtarı kapat → yarın yeni kopya oluşmaz; "Henüz otomatik yedek yok" satırı yalnız hiç kopya yokken görünür.

### A9. Hyper Focus diğer görevleri susturur  (📁 `src/lib/reminder.ts` → `activeFocusTaskId`, `focusSuppressedUntil`)

1. İki görev `A @5dk`, `B @5dk`; A'yı odağa alıp Hyper Focus başlat (çalışma 2 dk, mola 1 dk).
   → Çalışma turunda yalnız A hatırlatır; odak çubuğunda 🔕 çipi. Mola başlayınca B'nin bekleyen hatırlatması ilk
   kontrolde gelir.
2. Duraklat → B yine gelmez mi? Beklenen: duraklatılmış seans **susturmaz** (B gelir).
3. Ayarlar → anahtar kapalı → çalışma turunda B de gelir.

### A10. Güncelleyici *(kurulu sürüm)*  (📁 `electron/updater.ts`; `package.json › build.publish`)

1. Geliştirme modunda Ayarlar → Hakkında.
   → "Hyper Do Sürüm 0.2.0" ve "Güncellemeler yalnızca kurulu masaüstü uygulamasında denetlenebilir."
2. Kurulu 0.2.0 ile, GitHub'da daha yeni bir sürüm (`latest.yml` + exe) varken **Güncellemeleri denetle**.
   → "Denetleniyor…" → "x.y.z sürümü bulundu, indiriliyor…" → "x.y.z indiriliyor… %NN" → "x.y.z sürümü hazır.
   Kurmak için yeniden başlat." Ana pencerede "x.y.z güncellemesi hazır — Şimdi yeniden başlat / Sonra" bildirimi
   (mini/popup pencerelerde değil).
3. **Sonra** → bildirim kapanır, Ayarlar'daki **Şimdi yeniden başlat** kalır. **Şimdi yeniden başlat** → uygulama
   (tepsi kapatma korumasını aşarak) kapanır, kurulum çalışır, yeni sürüm açılır.
4. Yeni sürüm yokken denetle → "Güncelsin."
5. **Otomatik güncelleme** kapalı → yeniden başlat; 30 s ve 6 saat sonra hiç istek yok (konsolda updater satırı yok).
6. İndirilmiş güncelleme varken tepsi → Çıkış → çıkışta kurulur.
7. `npm run dist` çıktısında `latest.yml` var mı? Yoksa `build.publish` ayarı çalışmıyor demektir.

### A11. Tepsi, tek örnek, kapatma  (📁 `electron/main.ts` → `requestSingleInstanceLock`, `createRendererWindow`)

1. Pencereyi X ile kapat → tepsiye gizlenir, hatırlatmalar sürer. Tepsi simgesine tıkla → pencere geri gelir.
2. Tepsi menüsü: Aç · Hızlı ekle… · Mini pencere (onay kutusu) · Çıkış — dil değişince menü de çevrilir.
3. Uygulama açıkken exe'yi ikinci kez çalıştır → ikinci kopya açılmaz, ilk pencere öne gelir.
4. Ayarlar → "Görev çubuğunda yanıp sön" açıkken bildirimde görev çubuğu simgesi yanıp söner; "Hatırlatmada
   pencereyi öne getir" açıkken pencere öne gelir.

### A12. Yeni görev özellikleri (hızlı tur)  (📁 `src/App.tsx`, `src/components/TaskEditor.tsx`, `src/lib/parse.ts`, `src/lib/dates.ts`)

1. `E` → "Bunu dene: …" baloncuğu; 🎯 Odağa al / Başka; açık görev yoksa "Seçilecek açık görev yok 🌿".
2. `B` → büyük metin alanı; `- a\n* b\n1. c` → 3 görev, madde işaretleri yok.
3. Hızlı ekleme: `15 ekim 17:00 toplantı ~45dk ^düşük *haftalık` → önizlemede tarih, tahmin, enerji, tekrar çipleri;
   görev satırında `~45dk`, 🪫, `↻`. `anneyi ara 2 saat sonra` → başlık "anneyi ara", tarih +2 saat (Aralık değil!).
4. Düzenleyici → Tekrar → **Özel…**: "her 2 hafta" + Pzt/Çar; satır çipi `↻ Pzt·Çar`. "Bitince tekrarla" aç;
   görevi bitir → yeni kopya bitirme anından itibaren hesaplanır.
5. 31 Ocak tarihli aylık görevi bitir → sonraki 28 Şubat, sonra 31 Mart.
6. Hyper Focus ile bir görevde 2 tur (tahmin 5 dk) → satırda `Xdk / 5dk` turuncu (tahmin aşıldı). 📈 İstatistik:
   seri, en iyi seri, bugün / 7 gün, ısı haritası, odak dakikaları, etiketler.
7. Kenar çubuğu enerji çipleri etiket filtresiyle birlikte çalışır. `1`–`5` görünüm değiştirir, `/` aramaya gider,
   `Esc` kapatır; alan yazılırken harf kısayolları çalışmaz.
8. Üst çubukta 🔇 çipi (Telegram'dan `/mute 1sa` sonra) → tıkla → kalkar, hatırlatmalar döner.

### A14. 🧭 Şimdi ne yapayım?  (📁 `src/lib/whatnow.ts` → `rankNext`; `src/components/WhatNow.tsx`; `src/App.tsx` → `showNext`)

1. Üst çubukta **🧭 Şimdi ne?** (veya `W`) → pencere: Enerjin / Vaktin çipleri, tek kart (başlık, tarih, en çok 3
   gerekçe çipi), "1. öneri / N" satırı. Gecikmiş + yüksek öncelikli görev ilk sırada, gerekçesi "⏰ … gecikti".
2. **↻ Başka** → sıradaki öneri; sona gelince başa döner. Çip değiştirince sıra 1'den başlar.
3. Enerjiyi **🪫 Düşük** yap → ⚡ etiketli görevler en alta iner; **15 dk** → tahmini 45 dk olanlar en alta, ≤15 dk
   olan "⏱ … sürer, vaktine sığar" çipiyle öne çıkar.
4. **🎯 Odağa al** → pencere kapanır, görev odak çubuğunda ve satırı vurgulu. **⏱ Hyper Focus** → tur o görevle başlar
   (Hyper Focus çalışırken ve Mini App'te düğme yok). **✏ Aç** → düzenleyici.
5. Ertelenmiş ya da Pano'da "Bekliyor" sütunundaki görevler önerilmez; hiç aday yoksa "Şu an önerilecek görev yok 🌿".
6. Pencere açıkken diğer harf kısayolları çalışmaz; `Esc` / arka plana tıklama kapatır. Telefon genişliğinde
   (Mini App) düğmeler alt satıra kayar, yatay kaydırma yok.

### A13. Ses efektleri ve susturma  (📁 `src/lib/sound.ts` → `soundAllowed`; `src/lib/useSounds.ts`; `src/App.tsx` → `snd-btn`; `src/lib/useTaskActions.ts` → `onSound`)

1. Hızlı ekleme ile görev ekle → tek kısa "pop". Görevi sil → alçak, inen iki nota; **Geri al** → yükselen iki nota.
   Ertele (30 dk) veya "yarına" → inen iki nota; 🎯 odağa al → tek net nota. Kutuyu işaretle → A6'daki melodi.
2. Üst çubukta 🔊 düğmesi → tıkla → 🔇 olur, soluklaşır; aynı eylemler **tamamen sessiz** (tur zili dâhil). Ayarlar →
   **Ses efektleri** anahtarı da kapalı görünür. Tekrar tıkla → 🔊, sesler geri gelir.
3. Hyper Focus başlat (çalışma turu) → düğme kendiliğinden 🔇 olur; ipucunda "Hyper Focus: sesler susturuldu".
   Görev ekle / bitir / ertele → sessiz, konfeti yine var. Çalışma süresi dolunca **zil çalmaz**, yalnız bildirim
   gelir. Mola veya duraklatma sırasında sesler tekrar duyulur; mola bitince üç notalı zil **çalar**.
4. Hyper Focus sırasında 🔇'e tıkla → ayar kalıcı kapanır (mola geldiğinde de sessiz); Ayarlar'dan tekrar aç.
5. Mini pencerede **Bitti** / **Ertele** → aynı sesler mini pencereden de çalar. Uygulamayı kapat-aç → ayar korunur
   (`hyperdo-data.json` → `settings.sounds`).

---

## B. Telegram

Ön koşul: @BotFather'dan token; bot **yalnız masaüstünde** çalışır. Mesajlar HTML'dir: başlıklar kalın.

### B1. Eşleştirme ve durum satırı  (📁 `electron/telegram.ts` → `poll`, `sync`; `src/lib/telegram-commands.ts` → `/start`; `SettingsPanel.tsx › TelegramSection`)

1. Ayarlar → Telegram botu aç, token yapıştır.
   → Durum satırı "Başlatılıyor…" → birkaç saniyede "@botadı olarak çalışıyor · son yoklama 12:03". Altında 6 haneli
   **eşleştirme kodu**, ipucu ve **Telegram'da botu aç** bağlantısı.
2. Telefondan bota kodsuz `/start` veya yanlış kod.
   → "/start yazıp ardından Hyper Do → Ayarlar → Telegram'da görünen eşleştirme kodunu ekle."
3. `/start <doğru kod>` (veya bağlantı → Başlat).
   → "Bağlandık! 🎉 …"; Ayarlar'da "Bağlı ✓ sohbet <id>", kod kaybolur. **"/" menüsü** 22 komutu Türkçe
   açıklamalarla listeler.
4. Başka bir Telegram hesabından aynı bota `/start` → "Bu bot başka bir sohbete bağlı."
5. **Bağlantıyı kes** → yeni bir kod üretilir, eski sohbet artık yanıt almaz.
6. Token'ın bir karakterini boz.
   → "Hata: Telegram token'ı kabul etmedi — @BotFather'dan kontrol et" ve **yoklama durur** (konsolda 5 s'de bir
   hata **yok**). Token'ı düzelt → yeniden "… olarak çalışıyor".
7. Aynı token'ı ikinci bir Hyper Do (başka PC / Windows kullanıcısı) ile çalıştır.
   → Birinde "Hata: Bu botu başka bir Hyper Do zaten dinliyor"; 30 s'de bir yeniden dener, ötekini kapatınca düzelir.
8. İnterneti kes → durum "Hata: …" (ağ), 5→60 s geri çekilme; bağlanınca "… olarak çalışıyor". Oturum kilidi/boşta
   ile ilgisi yok.
9. Dili EN yap → "/" menü açıklamaları İngilizce olur (tek `setMyCommands`); dil değişmeden tekrar kaydet → istek yok.
10. 0.1.0'dan kalan, `chatId` dolu bir `hyperdo-data.json` ile aç → kod istenmeden bot yanıt verir.

### B2. Hatırlatma mesajı, düğmeler, canlı mesaj  (📁 `electron/telegram.ts` → `remind`, `setLive`, `onDataChanged`; `telegram-commands.ts` → `taskButtons`, `handleCallback`)

1. Görev `tg testi @5dk`.
   → Telegram'da **kalın başlık** + gövde, iki satır düğme: **✓ Bitirdim · 🎯 Odak** / **⏰ 30 dk · ⏰ 1 sa · 🌅 Yarın**.
2. 5 dk sonra ikinci hatırlatma.
   → Eski mesaj **silinir**, yenisi gelir (Ayarlar → "Yeni hatırlatma gidince aynı görevin önceki mesajını sil" açık).
   Anahtarı kapatınca eski mesaj kalır ama düğmeleri kalkar.
3. **✓ Bitirdim** → üstte kısa toast, mesaj düğmesiz "✓ …" satırıyla düzenlenir, görev PC'de biter; mesaj **bir** kez
   düzenlenir (üstü çizili + "✓" ikilemesi olmamalı).
4. Yeni hatırlatmada **⏰ 30 dk** / **⏰ 1 sa** → toast, düğmeler kalır, görev ertelenir. **🌅 Yarın** → mesaja
   "⏰ Sustu, <yarın 09:00> hatırlatırım: …" satırı eklenir (sessiz saatler açıksa bitiş saati).
5. **🎯 Odak** → görev odakta; PC'de odak çubuğu değişir.
6. Görevi **PC'de** bitir (kutucuk, bildirim düğmesi veya mini pencere).
   → Telegram'daki canlı mesaj ~~başlık~~ ✓ olur, düğmeler kalkar. Görevi sil → yalnız düğmeler kalkar.
7. A5'teki eşik aşılınca Telegram mesajı "👀 N kez görmezden geldin — hâlâ bitmedi mi?" satırıyla başlar; gövdede
   aynı satır **tekrar** yoktur.
8. Başlığı `<b>&test` olan görev → mesajda düz metin olarak görünür, Telegram hata vermez.
9. Uygulamayı yeniden başlat → eski mesajlardaki düğmeler hâlâ çalışır (id yoksa "bilinmeyen görev" toast'u) ve
   canlı-mesaj eşlemesi `%APPDATA%\hyper-do\hyperdo-telegram.json`'dan geri yüklenir: PC'den bitirince eski mesaj
   ~~başlık~~ ✓ olur; eski bir hatırlatmaya "yanıtla" → alt görev o göreve eklenir. *(19 Eki 2026'dan beri)*
10. Uygulama **kapalıyken** görevi başka cihazda bitir (eşitleme) ya da sil, sonra uygulamayı aç → bot başlarken o
   mesajı üstü çizili ✓ yapar / düğmelerini kaldırır. `hyperdo-telegram.json` yedeklere (`backups/`) **girmez**.

### B3. Komutlar  (📁 `src/lib/telegram-commands.ts` → `handleMessage`, `renderView`, `parseMuteArg`)

1. `/list` → **Gecikmiş · Bugün · Sonra · Tarihsiz** başlıkları, sürekli numaralama, altta 1…N numara düğmeleri
   (satırda 5, en çok 20). Boş sütunlar atlanır. `/list@botadı` aynı.
2. `/done 1 3 4` → "✓ Bitti: 3 görev"; `/done 99` → hata metni; `/d 2` takma ad çalışır.
3. `/snooze 2 yarın 09:00` → tarihe kadar; `/snooze 2 45` → 45 dk; `/s 2` → 30 dk.
4. `/today`, `/week`, `/overdue`, `/search fatura` → aynı biçim, numaralar bu görünüme göre; `/done 1` bu
   numaralamayı kullanır. Boş görünüm → "Burada bir şey yok 🌿".
5. `/stats` → bugün / 7 gün biten, seri, odak dakikaları (yoksa satır yok).
6. `/undo` → "↩ Geri açıldı: …"; tekrarlayan görevde "(sonraki tekrar duruyor)"; bitmiş görev yoksa uyarı.
7. `/due 2 cuma 17:00`, `/due 2 off`, `/due 2 saçma` → sırasıyla tarih, temizlendi, "Tarihi anlayamadım. Örnek:
   yarın 18:00".
8. `/prio 2 1`, `/prio 2 yüksek`, `/prio 2 x` → öncelik, öncelik, hata. `/every 2 2sa`, `/every 2 off`.
9. `/sub 2 alt görev`, `/note 2 not metni`, `/rename 2 yeni ad` → onay satırları; PC'de anında görünür.
10. `/del 2` → "… silinsin mi?" + **🗑 Sil / Vazgeç**; Sil → "🗑 Silindi: …", PC'den de kalkar (geri alınamaz,
    tombstone yazılır); Vazgeç → düğmeler kalkar, görev durur.
11. `/mute 2sa` → "🔇 Susturuldu, 14:30 itibarıyla tekrar açık"; PC üst çubuğunda "🔇 14:30 açılır" çipi; PC'ye de
    Telegram'a da hatırlatma gelmez. `/mute` → 1 sa; `/mute off` → "🔔 Hatırlatmalar geri geldi". `/mute 45dk`,
    `/mute 2ч` de çalışır.
12. `/quiet` → sessiz saatler açılır/kapanır, yanıt pencereyi söyler; `/quiet on|off`.
13. `/help` → Görevler · Görünümler · Hatırlatmalar · Diğer başlıklarıyla 22 komut, takma adlar parantezde, sonda
    düz yazı ve yanıt ipuçları. Bilinmeyen komut → aynı yardım.
14. Düz metin `yarın 18:00 fatura öde #ev !1 @30dk` → "➕ Eklendi: **fatura öde**" + 📅 / 🔴 / #ev / ⏰ satırları.
    Yalnız `yarın` → başlık "yarın", tarih yarın.
15. 60+ görev varken `/list` → birden çok mesaj, satır ortasından bölünmez, numaralar devam eder.

### B3b. `/next`  (📁 `telegram-commands.ts` → `nextReply`, callback `next:`)

1. `/next` (veya `/n`) → "🧭 Şimdi bunu yap:", kalın başlık, 📅 tarih, en çok 3 "•" gerekçe satırı; düğmeler
   ✓ Bitirdim · 🎯 Odak / ⏰ 30 dk · 1 sa · Yarın / **↻ Başka** (+ Mini App açıksa 📱 Uygulamada aç).
2. **↻ Başka** → sıradaki öneri **yeni mesaj** olarak gelir; eski mesajın düğmeleri çalışmaya devam eder.
3. Önerilen mesajda **✓ Bitirdim** → görev PC'de biter, mesaj "✓ …" satırıyla düzenlenir.
4. `/help` ve "/" menüsünde `/next` Görünümler grubunun başında.

### B4. Kartlar, yanıt = ekle, iletme/bağlantı  (📁 `telegram-commands.ts` → `renderCard`, `cardButtons`, `attach`, `linkTitle`; `electron/telegram.ts` → `byMessage`)

1. `/list` altındaki **2** düğmesi → kart: kalın başlık, tarih, öncelik, etiketler, notların ilk 300 karakteri,
   her alt görev için `☐ metin` düğmesi, B2'deki düğmeler, son satır **🗑 Sil · ✏ Öncelik**.
2. `☐` düğmesi → `☑`, kart **yerinde** düzenlenir. **✏ Öncelik** → 🔴→🟠→🟢 döner. **🗑 Sil** → onay.
3. Bir hatırlatmaya "yanıtla" ile `süt al` → "☐ Alt görev eklendi: …"; `not: kapıda` → "📝 Not eklendi: …";
   `заметка: x` de not. Bilinmeyen/eski bir mesaja yanıt → normal hızlı ekleme.
4. Başka sohbetten bir mesajı bota ilet → başlık ilk satır (≤ 80 karakter), notlar tam metin.
5. `https://example.com/uzun/yol` tek başına gönder → başlık "Bağlantı", notta URL. `Toplantı notları
   https://… yarın 10:00` → başlık "Toplantı notları", tarih yarın 10:00, notta URL.

### B5. Yalnızca bilgisayar boştayken  (📁 `electron/main.ts` → `idleSeconds`, `powerMonitor`; `telegram-commands.ts` → `shouldSendToTelegram`)

1. Ayarlar → Telegram → "Telegram'a yalnızca bilgisayar boştayken gönder" aç, 1 dk.
2. Fareyi oynatırken hatırlatma zamanı gelsin.
   → Masaüstü bildirimi gelir, Telegram **gelmez**.
3. PC'ye 1 dk dokunma → sonraki hatırlatma Telegram'a da gider.
4. Win+L ile kilitle → kilitliyken hatırlatma **hemen** Telegram'a gider (boşta süresi sonsuz sayılır); kilidi aç →
   kural geri döner.

### B6. Özet ve `/backup`  (📁 `telegram-commands.ts` → `digestReply`, `backupDocument`; `electron/telegram.ts` → `sendDigest`, `sendDocument`)

1. A7 adım 1 → Telegram'da "☀️ Günaydın" mesajı, ilk 3 görev **1 2 3** düğmeleriyle; düğme → kart; `/done 2` bu
   numarayı kullanır.
2. `/backup` → `hyperdo-backup-YYYY-MM-DD.json` dosyası, açıklama "Hyper Do yedeği · N görev · token çıkarıldı".
   Dosyayı aç: `settings.telegram.token` **boş**; Ayarlar → İçe aktar ile yüklenebilir.

### B7. Mini App — tünel, menü düğmesi, telefon  (📁 `electron/main.ts` → `applyMiniApp`, `spawnTunnel`; `electron/miniapp-server.ts`; `electron/tunnel.ts`; `src/lib/platform.telegram.ts`; `src/lib/tg-bridge.ts`; `src/App.tsx` → `IS_TG`)

Ön koşul: bot eşleşmiş (B1) ve `npm run build:web` çalışmış (`dist-web/tg.html` var). İnternet gerekli.

1. Ayarlar → Telegram → **Mini App** → *Telefon nasıl ulaşsın?* = **Cloudflare tüneli (otomatik)**.
   → Durum sırayla "Cloudflare yardımcısı indiriliyor… %NN" (ilk kez; `%APPDATA%\hyper-do\bin\cloudflared.exe`
   oluşur), "Tünel başlatılıyor…", sonra "Erişilebilir:" + `https://….trycloudflare.com` + **Kopyala** + "yerel
   port NNNNN". `dist-web` yoksa → "Hata: Web derlemesi yok: npm run build:web çalıştır".
2. Kopyalanan adresi PC'de tarayıcıda aç → `/tg.html`'e yönlenir, boş bir sayfa / "Bilgisayarına bağlanılıyor…"
   (Telegram dışında `initData` yok: normal). `…/index.html` → 404. `…/api/rev` → 401 JSON.
3. Telefonda bot sohbetini aç → metin kutusunun solunda ☰ **Hyper Do** düğmesi belirir (gerekirse sohbetten çık-gir).
   Dokun → Mini App açılır: alt sekme çubuğu **Bugün · Bu hafta · Pano · Bitenler · ＋**, kenar çubuğu yok,
   "+ Yeni görev" ve sıralama seçicisi yok, Telegram koyu/açık temasına uyar.
4. Telefonda ＋ → hızlı ekleme kutusu odaklanır; "yarın 18:00 fatura #ev" yaz, Enter → görev listede.
   → PC'deki pencerede aynı görev **3 sn içinde** görünür (`rev` yoklaması; PC ana penceresi `tidi:data-changed`).
5. PC'de bir görevi bitir → telefonda 3 sn içinde Bitenler'e düşer. Telefonda bir görevi bitir → titreşim (haptic),
   PC'de bitti; o görevin canlı Telegram mesajı ~~başlık~~ ✓ olur (B2 yolu).
6. Telefonda görevin ✎ düğmesi → düzenleyici **alttan açılan sayfa** gibi; Telegram'ın **Geri** düğmesi görünür ve
   düzenleyiciyi kapatır. Beyin boşaltma (🧠) ve istatistikler de Geri ile kapanır.
7. Bir hatırlatma gönder (B2 adım 1) → mesajın altında **üçüncü satır** "📱 Uygulamada aç"; dokun → Mini App o
   görevin düzenleyicisiyle açılır (`?task=<id>`). Kart ve sabah özetinde de aynı satır (özette `?task` yok).
8. Uçak modu / PC'de **Tüneli yeniden başlat** sırasında telefonda bir görevi değiştir → başlıkta
   "⚠ Kaydedilmedi · Yeniden dene" çipi; bağlantı dönünce çip kaybolur, değişiklik PC'ye ulaşır. Mini App'i kapatıp
   açınca, PC kapalıysa tam ekran "Bilgisayarındaki Hyper Do'ya ulaşılamıyor" + **Yeniden dene**.
9. Başka bir Telegram hesabından aynı bota ☰ düğmesi yok (menü düğmesi yalnız bağlı sohbete kurulur). Adresi elle
   açsa bile → "Bu hesap için değil" (403).
10. Görev Yöneticisi'nden `cloudflared.exe`'yi öldür → durum "Hata: Tünel kapandı (çıkış kodu …); 5 sn sonra
    yeniden denenecek", 5 sn sonra yeni bir adres (ardışık düşüşlerde 10, 20, 40, 60 sn). Yeni adres botun ☰ düğmesine
    otomatik işlenir. Mod **Kapalı** → durum "Kapalı", `cloudflared` süreci yok, ☰ düğmesi kaybolur.
11. Mod **Kendi adresim**: durum "Tünel başlatılıyor…" + yerel port; `ngrok http <port>` (ya da Tailscale Funnel)
    çalıştır, verdiği `https://` adresi alana yapıştır, Enter → "Erişilebilir:"; `http://` yazarsan altında kırmızı
    "Adres https:// ile başlamalı." ve kaydedilmez. Adres değişince yerel port **değişmez**.
12. PC'de uygulamayı tepsiden kapat → `cloudflared` süreci biter. Ayarlar → Telegram → Dil değiştir → Mini App
    durum metinleri yeni dilde.

---

## C. Android

Ön koşul: `npm run android:apk`, APK telefona kurulur, bildirim izni verilir, Pil → Kısıtlamasız.

> **14 Eki 2026 — emülatörde (Pixel, Android 16 / API 36) doğrulandı:** C1 bildirim düğmeleri (🎯 Odak ve ✓ Bitirdim
> uçtan uca; 😴 30 dk aynı yol), C2 Paylaş → Hyper Do (uygulama açıkken ve kapalıyken), C4 WebDAV eşitleme
> (telefon ↔ ikinci cihaz, tamamlanma ve 🔥 sayacı dahil). Bu turda bulunup düzeltilenler: exact-alarm izni
> yoktu → bildirimler dakikalarca gecikiyordu (`USE_EXACT_ALARM` + izin banner'ı); WebDAV URL'sini klavye
> `Http://` yapınca Capacitor native HTTP devreye girmiyordu (URL alanı `autoCapitalize=none` + şema küçük harfe
> çevriliyor); "az önce önce" metni. **Hâlâ elde test gerektiren:** C3 Google OAuth (Android client ID lazım),
> gerçek cihazda Doze/pil kısıtlaması altında bildirim zamanlaması, C5 genel kontroller.

### C1. Bildirim düğmeleri  (📁 `src/lib/platform.capacitor.ts` → `registerActionTypes`, `localNotificationActionPerformed`; `src/lib/stats.ts` → `applyNotificationAction`)

1. Görev `android @5dk`, telefonu kilitle.
   → Bildirim gelir; genişletince **✓ Bitirdim · 😴 30 dk · 🎯 Odak** (uygulama dilinde).
2. **✓ Bitirdim** → uygulama açılır, görev Bitti'de, seri sayacı arttı, o göreve ait planlı bildirimler iptal (5 dk
   sonra yeni bildirim yok). Günlük tekrarlayan görevde yeni kopya oluşur.
3. Başka bir bildirimde **😴 30 dk** → satırda erteleme, 30 dk sessiz.
4. **🎯 Odak** → görev odakta ve vurgulu. Bildirim gövdesine dokun → uygulama görevde açılır, değişiklik yok.
5. Dili TR→EN değiştir, yeni hatırlatma → düğme adları İngilizce (tür yeniden kaydedilir).
6. Uygulamayı 2+ gün açma → hatırlatmalar durur (48 saatlik plan, bilinen sınır); açınca plan uzar.
7. Görev `nag @1dk` (eşik: Ayarlar → Tırmanma, örn. 3), uygulamayı kapat, 4–5 bildirime dokunma, sonra aç.
   → 👀 çipi çalan bildirim sayısını gösterir; eşikten sonraki bildirimlerin gövdesi "👀 N kez görmezden geldin…"
   satırıyla başlar. **😴 30 dk** ya da düzenleme → sayaç 0'dan başlar, eski bildirimler tekrar sayılmaz.
   Seviye 2 (açılır pencere) Android'de yoktur. *(19 Eki 2026'dan beri; önceden sayaç hiç artmıyordu)*

### C2. Paylaş → Hyper Do  (📁 `android/app/src/main/java/com/hyperdo/app/MainActivity.java`; `platform.capacitor.ts` → `hyperdoShare`; `src/lib/share.ts`)

1. Chrome'da bir sayfa → Paylaş → **Hyper Do**, uygulama **kapalıyken**.
   → Uygulama açılır, düzenleyici sayfa başlığıyla (konu) açılır, notta URL.
2. Uygulama **açıkken** aynı paylaşım → ikinci örnek yok, düzenleyici açılır.
3. Not uygulamasından düz metin (3 satır) → başlık ilk satır (120 karakterde kesilir), notlar tam metin.
4. Aynı sayfayı 2 s içinde iki kez paylaş → tek düzenleyici.
5. Yalnız URL paylaş → başlık URL, notta URL.

### C3. Google Takvim (OAuth, Custom Tab)  (📁 `platform.capacitor.ts` → `androidConnect`, `appUrlOpen`; `src/lib/gcal.ts` → `ANDROID_REDIRECT_URI`; `AndroidManifest.xml` şema `com.hyperdo.app`)

1. Ayarlar → Takvimler → **Android Client ID** alanı ve keytool yardım metni görünür; Client ID/secret alanları yok.
2. Android türü OAuth istemcisinin id'sini yapıştır → **Bağlan**.
   → Tarayıcı sekmesi Google onayını açar; onaydan sonra uygulamaya döner (`com.hyperdo.app:/oauth2redirect`),
   durum "Bağlı · e-posta", takvimler listelenir, etkinlikler Bugün/Bu hafta üstünde ve görev olarak gelir.
   Google yönlendirme şemasını reddederse (hata sayfası) → `ANDROID_REDIRECT_URI` ve manifest ters-client-id
   şemasına çevrilmeli (bilinen risk).
3. Onayı iptal et → kırmızı hata satırı. Bağlantıyı kes → yeniden bağlan çalışır.
4. Sekme geri yığınında kalırsa Geri tuşu uygulamaya döner (`Browser.close()` en iyi çaba).
5. Android Client ID boşken → yalnız ICS beslemeleri sunulur ("Google girişi bu uygulama sürümünde henüz yok.
   Takvimin ICS bağlantısını ekle.").

### C4. WebDAV eşitleme telefonda  (📁 `src/lib/platform.sync.ts`, `src/lib/synctransport.ts`; `capacitor.config.ts` → `CapacitorHttp`)

En riskli Android maddesi: `CapacitorHttp`'nin yamaladığı `fetch`'in `ETag` başlığını döndürmesi ve `If-Match`'i
geçirmesi test edilmedi.

1. Ayarlar → Cihazlar arası eşitleme → **WebDAV**, PC'deki (E1) aynı URL + kullanıcı + uygulama parolası →
   **Kimlik bilgilerini kaydet** → "Kaydedildi." ve parola alanında "kaydedildi" rozeti.
   → Durum "Son eşitleme: 0 dk önce"; PC'nin görevleri **tek kopya** olarak gelir.
2. Telefonda bir görev ekle → 2 s içinde PC'de görünür (PC'de 60 s içinde).
3. PC'de bir görevi değiştir, telefonda **Şimdi eşitle** → değişiklik gelir; ikinci basış 304 ile hızlı döner
   (ağ trafiğinde GET'e `If-None-Match`).
4. Her iki cihazda aynı anda **Şimdi eşitle** → en çok bir kez "Dosya aynı anda başka bir cihazdan yazıldı…" satırı,
   sonraki eşitlemede kaybolur, iki tarafın değişikliği de durur. 412 sonsuz döngüde kalıyorsa ETag zayıf/yok.
5. Yanlış parola → "Sunucu kullanıcı adı/parolayı kabul etmedi (401/403)."; düzelt → satır kalkar.
6. Kimlik bilgileri `hyperdo-data` içinde **yok** (Dışa aktar → JSON'da `webdav` parolası aranmaz, bulunmaz).

### C5. Genel Android kontrolleri

1. Ayarlar'da Masaüstü ve Telegram grupları **yok**; Hakkında "sürüm 0.2.0" + "Bu platformda güncellemeler elle
   yapılır…"; **Sabah özeti** ve **Akşam değerlendirmesi** anahtarları var (C6).
2. Sessiz saatler ve `/mute` (PC'den eşitlenmez — ayar) → telefonda ayrı ayarlanır; sessiz saatte planlanan bildirim yok.
3. Hyper Focus çalışma turunda diğer görevlerin planlı bildirimleri tur sonuna kadar atlanır (plan yeniden kurulur).
4. "Bildirimi dene" düğmesi → test bildirimi. JSON dışa/içe aktarma çalışır.

### C6. Sabah özeti / akşam değerlendirmesi  (📁 `src/lib/digest.ts` → `planDigestTimes`, `buildDigest`; `platform.capacitor.ts` → `reschedule`)

1. Ayarlar → **Sabah özeti** açık, saat şimdi + 2 dk; uygulamayı kapat, telefonu kilitle.
   → Saatinde "Günaydın"lı bildirim: gecikmiş / bugün / açık sayıları + ilk 3 görev (genişletince tam metin).
2. **Akşam değerlendirmesi** açık, saat şimdi + 2 dk → "Bugün N bitti…" bildirimi. Pazar günü aynı saat → haftalık özet.
3. Özetten önce bir görevi bitir → özetteki sayılar güncel (her kayıtta plan yeniden kurulur).
4. Özet bildirimine dokun → uygulama açılır, değişiklik yok. Anahtarları kapat → planlı özet bildirimi kalmaz.
5. Bilinen sınır: uygulama 2+ gün açılmazsa özetler de durur (48 saatlik plan). Sessiz saatler özeti bastırmaz
   (masaüstüyle aynı).

---

## D. Web / PWA

`npm run dev:web` → http://localhost:5180 (veya yayınlanmış `dist-web`).

### D1. Bildirimler  (📁 `src/lib/platform.web.ts`; `public/sw.js`)

1. İlk açılışta izin istenir; Ayarlar → "Bildirimi dene" → tarayıcı bildirimi.
2. Görev `web @5dk` → sekme açıkken 30 s içinde bildirim; bildirime tıkla → sekme öne gelir, görev vurgulanır.
3. Sekmeyi kapat → bildirim gelmez (Ayarlar'daki not bunu söyler). iPhone: Ana ekrana ekle → oradan açılınca izin
   istenebilir (iOS 16.4+).
4. 👀 sayacı web'de **artar** (web motoru sayar); çip görünür.

### D2. WebDAV + CORS  (📁 `src/lib/synctransport.ts`; sunucu CORS ayarı)

1. CORS'u olmayan bir WebDAV sunucusu → durum satırında ağ hatası (tarayıcı konsolunda CORS), veri bozulmaz.
2. CORS'u açık sunucu (`If-Match`, `If-None-Match` başlıkları izinli) → E1'deki akış aynen; kimlik bilgileri
   `localStorage` `hyperdo-sync` anahtarında, `hyperdo-data` içinde **değil**.
3. Ayarlar'da **Klasör** modu **görünmez** (dizin seçici yok).

### D3. Google (web yönlendirmesi)  (📁 `src/lib/platform.calendar.ts`)

1. Web türü OAuth istemcisi, yetkili yönlendirme URI'si = sayfa adresi → **Bağlan** → Google'a gider, geri döner,
   "Bağlı · e-posta". Etkinlikler görev olur; "Görevleri Google Takvim'e gönder" → "Hyper Do" takvimi oluşur.
2. Yenile (F5) → bağlantı kalır (`hyperdo-calendar` anahtarı); JSON dışa aktarmada token **yok**.
3. *(Masaüstünde de)* "Her hafta Pzt/Çar 18:00" özel tekrarlı görev → Google'daki "Hyper Do" takviminde **seri**
   olarak görünür (önümüzdeki haftalar da dolu, saat dilimi doğru, 18:00–18:30). Bir sonraki tekrarlar görev olarak
   **geri gelmez**.
4. Görevi bitir → eski seri silinir, yeni kopya bir sonraki tarihten başlayan yeni seri olarak gelir (çift seri yok).
5. Tekrarı kaldır → takvimde tek etkinlik kalır (seri silinip yeniden oluşturulur). Tekrar ekle → tekrar seri olur.
6. 31 Ekim tarihli aylık görev → Kasım'da 30'unda, Şubat'ta 28'inde görünür (atlanmaz). "Bitince tekrarla" → tek
   etkinlik. Gün boyu (23:59) günlük görev → gün boyu seri.

### D4. Genel

1. 0.1.0 verisiyle (eski `localStorage`) aç → görevler ve eski Hyper Focus seansı (`hyperdo-hyperfocus` anahtarı)
   taşınır, konsolda hata yok.
2. Ayarlar: Masaüstü, Telegram, Sabah özeti grupları yok; Hakkında sürüm 0.2.0 + elle güncelleme notu.
3. ICS beslemesi CORS yüzünden yüklenmezse besleme satırında hata; masaüstünde aynı adres çalışır.
4. Mini/pencere kısayolu `M` web'de hiçbir şey yapmaz; `N / E B 1-5 Esc` çalışır.

---

## E. Senkron (iki cihaz)

A = Windows masaüstü, B = telefon (C4) ya da web (D2). Tek PC'de deneme: masaüstü tek örnek olduğu için B olarak
web sürümünü kullan.

### E1. WebDAV ile iki cihaz  (📁 `src/lib/syncengine.ts`, `src/lib/sync.ts` → `mergeData`; `src/lib/tasks.ts` → `bumpChanged`/`onlyNagChanged`)

1. Sunucuda `HyperDo` klasörü. A: Ayarlar → Eşitleme → WebDAV, dosya URL'si, kullanıcı + uygulama parolası →
   **Kimlik bilgilerini kaydet**.
   → "Son eşitleme: 0 dk önce"; sunucuda `hyperdo-sync.json` oluştu (ilk yazım `If-None-Match: *`).
2. B: aynı URL ve bilgiler → A'nın görevleri **çift olmadan** gelir; B'nin dili/teması değişmez.
3. A'yı çevrimdışı yap. A'da bir görevi yeniden adlandır; B'de başka bir görevi sil, üçüncüsünü bitir. A'yı bağla.
   → Üç sonuç da iki tarafta; 📈 İstatistik sayaçları eşit; sessiz saatler/dil her cihazda kendi değeri.
4. A'da bir görevi sil, 6 s içinde **Geri al** → sonraki eşitlemede B'de **kalır** (tombstone düşer, görev daha yeni).
5. A'da sil, geri alma; B'de **aynı görevi** silmeden önce düzenle (çevrimdışı), bağla → görev **geri gelir**
   (silmeden sonraki düzenleme kazanır).
6. **Nag kuralı:** B çevrimdışıyken B'de bir görevi yeniden adlandır. A'da aynı görevin hatırlatması 2 kez gelsin
   (👀 sayacı artar, görev başka türlü değişmesin). B'yi bağla.
   → B'nin **yeni adı kazanır**; A'daki 👀 sayısı yerel kalır (B'de farklı olabilir). A'nın eski adı geri geliyorsa
   `markNagged`/`bumpChanged` `updatedAt`'i yükseltmiş demektir.
7. Yanlış parola → "Sunucu kullanıcı adı/parolayı kabul etmedi (401/403)."; sunucu 500 / dosya bozuk →
   "… bir Hyper Do eşitleme dosyası değil." veya "HTTP 500", **yerel veri ve dosya dokunulmaz**.
8. Ayarlar → mod **Kapalı** → eşitleme durur, durum satırı gider; tekrar WebDAV → kaldığı yerden sürer (cihaz id aynı).
9. `hyperdo-sync.json`'u sunucudan indirip aç → `settings`, `telegram`, `token` anahtarları **yok**; `tasks`,
   `deleted`, `dailyDone`, `focusLog`, `deviceId`, `savedAt` var.

### E2. Klasör modu  (📁 `electron/syncfolder.ts`; `electron/main.ts` → `tidi:sync-pick-folder`)

1. Ayarlar → Eşitleme → **Klasör** → **Seç…** → OneDrive/Dropbox/düz klasör.
   → `<klasör>\hyperdo-sync.json` oluşur; `.hyperdo-sync.json.<pid>.tmp` kalıntısı **yok**.
2. Dosyayı elle düzenle: bir görevin `title`'ını değiştir ve `updatedAt`'ini büyüt, kaydet.
   → ~1 s içinde uygulamada yeni başlık (fs.watch). `updatedAt`'i büyütmezsen değişmez (yerel kopya daha yeni).
3. Uygulamada görev ekle → dosya 2 s içinde güncellenir, `savedAt` artar.
4. İkinci PC (veya ikinci Windows kullanıcısı) aynı mirrorlanan klasörü seçsin → E1 adım 2–5 klasörle tekrarlanır;
   bulut istemcisi dosyayı teslim edince uygulama kendi alır.
5. İki PC aynı saniyede yazarsa kaybeden "aynı anda yazıldı" satırını gösterip yeniden birleştirir; veri kaybı yok.
6. Bilinen sınır: bulut istemcisi dosyayı **aynı mtime** ile teslim ederse değişiklik bir sonraki yerel değişikliğe
   kadar fark edilmez.

### E3. Eşitlenmeyenler

1. A dili TR, B dili EN → eşitlemeden sonra her biri kendi dilinde.
2. A'da Telegram bağlı → B'de Telegram ayarı boş kalır; dosyada token yok (E1 adım 9).
3. A'da Hyper Focus çalışıyor → B'de seans başlamaz (yalnız biten turlar `focusLog` ile gelir, 📈'de dakikalar görünür).
4. Takvim bağlantıları ve beslemeler cihaz başına.
