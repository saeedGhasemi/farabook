## هدف
وقتی اینترنت قطع است، اپ بالا بیاید، قفسهٔ «کتاب‌های من» نمایش داده شود و کاربر بتواند کتاب‌های آفلاین‌شده را با تصاویر و ویدیوهای embed شده باز کند و بخواند. وقتی آنلاین است همه‌چیز (فروشگاه، پروفایل، AI، ...) مثل قبل کار کند.

## وضعیت فعلی (مشکلات)
1. **اپ آفلاین بالا نمی‌آید** — هیچ Service Worker یا PWA‌ای نصب نیست. اولین لود کاملاً به شبکه وابسته است.
2. **Library به Supabase وابسته است** — اگر `user_books` لود نشود، صفحه خالی می‌ماند، حتی اگر کتاب آفلاین داشته باشیم.
3. **Reader هم وابسته به session زنده Supabase است** — `Reader.tsx` بدون auth zinde بالا نمی‌آید.
4. **تصاویر/ویدیوهای داخل صفحات کتاب آفلاین نمی‌شوند** — `OfflineStore.downloadBook` فقط cover را cache می‌کند. URLهای داخل بلاک‌های `image`، `video`، `figure`، iframe embed (YouTube/Aparat/Vimeo) دانلود نمی‌شوند.
5. **هیچ بسته‌بندی نصب‌پذیر روی موبایل/ویندوز در دسترس کاربر نیست** — Capacitor فقط `config` دارد، PWA install prompt نداریم.

## رویکرد
**Stack دوگانه**: PWA (همه پلتفرم‌ها، نصب از مرورگر) + Capacitor (موجود، برای build اندروید/iOS). برای ویندوز، PWA نصب‌پذیر کافی است (Chrome/Edge → Install).

---

## فازها (ترتیب اجرا)

### فاز ۱ — PWA shell + offline boot
- نصب `vite-plugin-pwa` با استراتژی محتاطانه:
  - `registerType: "autoUpdate"`
  - `devOptions.enabled: false` (فقط در production)
  - **Guard ضد iframe و دامنه‌های preview/lovable** در `main.tsx` — SW فقط در دامنهٔ منتشرشده فعال شود تا preview Lovable خراب نشود
  - `navigateFallbackDenylist: [/^\/~oauth/, /^\/auth/, /^\/api/]`
  - `runtimeCaching`:
    - HTML navigations → `NetworkFirst` (3s timeout) → fallback به cached shell
    - JS/CSS hashed assets → `CacheFirst`
    - فونت‌ها/تصاویر استاتیک → `StaleWhileRevalidate`
    - درخواست‌های Supabase REST/Auth → **هرگز کش نشوند**
- `manifest.webmanifest`: نام «فرابوک»، `display: "standalone"`، `theme_color`، `background_color`، آیکن‌ها (192/512/maskable)، `start_url: "/library"` تا offline به قفسه برسد
- آیکن‌های PWA در `public/icons/` (تولید سریع با imagegen)
- صفحهٔ `/install` با راهنمای نصب iOS/Android/Windows + شناسایی `beforeinstallprompt`
- لینک «نصب اپ» در Navbar وقتی قابل نصب است

### فاز ۲ — Offline-aware Library
- `useOfflineLibrary(userId)` hook: همیشه ابتدا از `OfflineStore.listLocalBooks(userId)` (IndexedDB) می‌خواند → فوراً render
- سپس در پس‌زمینه `user_books` را fetch می‌کند و merge می‌کند
- بنر آفلاین در بالای Library: «حالت آفلاین — فقط کتاب‌های دانلود‌شده نمایش داده می‌شوند»
- فیلتر/تب «فقط آفلاین»
- استفاده از `navigator.onLine` + listener `online`/`offline` در یک Context (`NetworkStatusProvider`) برای کل اپ
- روی Navbar/Store/Profile وقتی offline است گزینه‌های نیازمند شبکه به‌صورت disabled با tooltip نمایش داده شوند

### فاز ۳ — Offline-aware Reader
- `Reader.tsx`: اگر offline و کتاب موجود در `OfflineStore` است → مستقیم از `loadOfflineBook` بخوان بدون انتظار برای Supabase session refresh
- ReadingLock فقط در حالت online فعال؛ در offline یک badge «حالت آفلاین — قفل جلسه غیرفعال» نمایش می‌دهد (sync بعدی حل می‌کند)
- highlight/progress local-first (پیاده شده) — فقط مطمئن می‌شویم در offline crash نمی‌کند

### فاز ۴ — Offline media (تصاویر + ویدیو)
این مهم‌ترین تغییر در `OfflineStore.downloadBook` است:
- در `pagesArr` recursive walk → استخراج همهٔ URLهای:
  - `image` / `figure` / `cover` blocks → `src`
  - `video` blocks → `src` + `poster`
  - `audio` blocks
  - بلاک‌های embed با host شناخته‌شده (YouTube, Aparat, Vimeo) → ذخیرهٔ شناسه برای نمایش placeholder در offline (دانلود ویدیوی YouTube غیرقانونی است؛ اما اگر embed self-hosted باشد فایلش را می‌گیریم)
- هر asset را با `fetch`، encrypt، در `book_assets` ذخیره کن. کلید: hash از URL
- **Rewrite بلاک‌ها**: قبل از encrypt هر page، URLها را با `offline-asset://{bookId}/{assetKey}` جایگزین کن
- در `BlockRenderer`/`Reader` یک resolver: اگر src با `offline-asset://` شروع شد → از `readAsset` بخوان، `URL.createObjectURL` بده، در unmount revoke کن
- `useOfflineAsset(bookId, assetKey)` hook برای lifecycle blob URL
- progress bar دانلود اکنون شامل assets هم باشد؛ `totalBytes` بعد از walk معلوم می‌شود
- اگر دانلود یک asset شکست خورد، در `last_error` ثبت شود اما کل دانلود را نشکن (graceful degrade)

### فاز ۵ — تست‌های پایداری
- تست unit برای `walkAssetUrls` (استخراج صحیح URL از انواع بلاک)
- تست برای URL rewriting (idempotent، روی re-download)
- تست offline boot: با Service Worker mock، `/library` باید render شود
- تست SyncEngine: شکست شبکه → backoff → بازیابی

### فاز ۶ — بسته‌بندی
- مستندسازی در README:
  - **PWA (توصیه‌شده)**: کاربر در Chrome/Edge روی موبایل یا ویندوز → دکمهٔ «نصب اپ»
  - **APK اندروید**: `npx cap sync android && npx cap build android` (روی ماشین خود کاربر)
  - **iOS**: همان flow با Xcode
- صفحهٔ `/install` با تب جدا برای هر پلتفرم + اسکرین‌شات راهنما

---

## بخش فنی (جزئیات پیاده‌سازی)

### فایل‌های جدید
```
public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
public/manifest.webmanifest
src/lib/network/NetworkStatusProvider.tsx
src/hooks/useNetworkStatus.ts
src/hooks/useOfflineLibrary.ts
src/hooks/useOfflineAsset.ts
src/lib/offline/assetWalker.ts        // walk + rewrite URLs in page blocks
src/lib/offline/assetResolver.ts      // offline-asset:// → blob URL
src/lib/pwa/registerSW.ts             // iframe/preview guard
src/components/InstallAppButton.tsx
src/pages/Install.tsx
src/components/OfflineBanner.tsx
src/lib/offline/__tests__/assetWalker.test.ts
```

### فایل‌های ویرایش‌شده
```
vite.config.ts                         // VitePWA plugin
index.html                             // manifest link, theme-color
src/main.tsx                           // registerSW + NetworkStatusProvider
src/App.tsx                            // OfflineBanner, route /install
src/components/Navbar.tsx              // InstallAppButton
src/pages/Library.tsx                  // useOfflineLibrary, offline filter
src/pages/Reader.tsx                   // offline-first load path
src/lib/offline/OfflineStore.ts        // walkAssets + cache + rewrite
src/lib/offline/types.ts               // BookPageRow.original_urls?
src/components/reader/BlockRenderer.tsx // offline-asset:// resolver
```

### نکات کپی‌رایت و امنیت
- ویدیوهای YouTube/Aparat: دانلود نمی‌کنیم (نقض ToS). فقط در online قابل پخش‌اند → در offline یک placeholder «این ویدیو نیاز به اینترنت دارد» نمایش می‌دهیم
- همهٔ asset‌های دانلود‌شده با همان کلید AES-GCM موجود رمز می‌شوند (محتوای ناشر محافظت می‌شود)
- محدودیت ۲ دستگاه و reading lock (پیاده‌شده) دست‌نخورده می‌ماند

### ریسک‌ها
- حجم asset: کتاب با ویدیوی self-hosted می‌تواند صدها MB شود → نمایش هشدار حجم قبل از شروع دانلود + امکان «دانلود بدون ویدیو»
- iOS PWA: محدودیت IndexedDB ~۵۰MB پیش از prompt → باید `navigator.storage.persist()` صدا زده شود
- Service Worker در preview Lovable: حتماً guard فعال

## ترتیب اجرا
1. فاز ۱ (PWA shell + boot) — مهم‌ترین، بدونش بقیه بی‌اثرند
2. فاز ۲ (Library offline) — رفع مشکل اصلی کاربر
3. فاز ۴ (media offline) — درخواست صریح کاربر
4. فاز ۳ (Reader offline polish)
5. فاز ۵ (تست‌ها)
6. فاز ۶ (مستندسازی نصب)

پس از تأیید، فاز ۱ و ۲ را در همین پاسخ اجرا می‌کنم؛ فاز ۴ در پاسخ بعدی (چون تغییرات OfflineStore سنگین است و بهتر است جدا تست شود).