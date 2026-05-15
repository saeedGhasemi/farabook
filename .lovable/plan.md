# پلن نهایی نسخه آفلاین فرابوک (با محدودیت دستگاه و قفل خواندن همزمان)

هدف: کاربر بتواند کتاب‌های خریداری‌شده را بدون اینترنت بخواند، هایلایت/یادداشت بزند، و با اتصال مجدد همگام‌سازی شود — بدون نقض کپی‌رایت، بدون مصرف بی‌مورد ترافیک، بدون اینکه کش جلوی به‌روزرسانی محتوا/سایت را بگیرد، با محدودیت دو دستگاه برای آفلاین و قفل خواندن همزمان روی یک کتاب.

---

## ۱. معماری کلی

```text
┌─────────────────────────────────────────────────────────┐
│  UI (React)                                             │
│  ├─ Reader / Library / Highlights                       │
│  └─ OfflineStore (interface مشترک)                      │
│       ├─ Web      → IndexedDB + AES-GCM                 │
│       └─ Mobile   → SQLCipher (capacitor-community)     │
│                                                         │
│  DeviceManager       (ثبت/لیست/حذف دستگاه‌ها)            │
│  ReadingLockManager  (قفل تک‌دستگاهی روی هر کتاب)         │
│  SyncEngine          (online-only، با صف و retry)        │
│  CopyProtection      (موجود) + DRM-lite                  │
└─────────────────────────────────────────────────────────┘
                  ↕ HTTPS (فقط آنلاین)
       Supabase  (books, highlights, edge functions)
```

---

## ۲. کپی‌رایت و حفاظت از فایل آفلاین

- **رمزنگاری at-rest:** کلید SQLCipher = `SHA-256(user.id + device-salt + server-pepper)`.
- `device-salt` در Keychain/Keystore/IndexedDB غیرقابل‌خروج.
- `server-pepper` با Edge Function `issue-book-key` پس از احراز مالکیت و چک محدودیت دستگاه صادر می‌شود؛ به `device_id` گره می‌خورد → کپی DB روی دستگاه دیگر باز نمی‌شود.
- هیچ فایل خام HTML/تصویر روی فایل‌سیستم آزاد ذخیره نمی‌شود.
- CopyProtection موجود (غیرفعال‌سازی copy/selection) حفظ می‌شود.
- Revocation: اگر کتاب از قفسه حذف شد، در sync بعدی پاک می‌شود.

---

## ۳. محدودیت دو دستگاه برای آفلاین (جدید)

**قانون:**
- کاربر روی **هر تعداد دستگاه** می‌تواند پس از لاگین کتاب را **آنلاین** بخواند.
- **حداکثر دو دستگاه** می‌توانند نسخه آفلاین (دانلودشده) داشته باشند.
- اگر دستگاه سوم بخواهد آفلاین کند → پیام: «شما به سقف ۲ دستگاه آفلاین رسیده‌اید. یکی از دستگاه‌های زیر را آزاد کنید» + لیست با دکمه «آزادسازی».
- آزادسازی → پاک شدن DB رمزشده روی آن دستگاه در sync بعدی + invalidate شدن کلید.

**جدول جدید `user_offline_devices`:**
- `id, user_id, device_id, device_label, platform, last_seen_at, created_at`
- UNIQUE `(user_id, device_id)`.
- RLS: کاربر فقط ردیف‌های خودش، insert/delete با `auth.uid() = user_id`.

**Edge Function `issue-book-key`:**
- ورودی: `book_id`, `device_id`, `device_label`, `platform`.
- چک: کاربر مالک کتاب باشد، و یا این `device_id` قبلاً ثبت شده، یا تعداد دستگاه‌های ثبت‌شده < ۲.
- خروجی: `pepper` مخصوص (book + device + user) + ثبت/به‌روز کردن `user_offline_devices`.
- در صورت نقض سقف → 409 با لیست دستگاه‌های فعلی.

**UI:**
- صفحه «دستگاه‌های من» در Profile: لیست دستگاه‌های آفلاین، دکمه «آزادسازی».
- در Library کنار دکمه «دانلود برای آفلاین» نشانگر سقف.

---

## ۴. قفل خواندن همزمان روی یک کتاب (جدید)

**قانون:**
- در هر لحظه فقط **یک دستگاه** می‌تواند یک کتاب مشخص از یک کاربر را در حال خواندن داشته باشد (آنلاین یا آفلاین).
- باز کردن همان کتاب در دستگاه دوم → دستگاه اول پیام «این کتاب در دستگاه دیگری باز شد» + غیرفعال شدن Reader.
- کاربر در دستگاه قبلی می‌تواند «ادامه می‌دهم اینجا» بزند → دستگاه جدید به همان شکل قفل می‌شود.

**جدول جدید `book_reading_sessions`:**
- `id, user_id, book_id, device_id, started_at, last_heartbeat_at, released_at`
- UNIQUE partial index: `(user_id, book_id) WHERE released_at IS NULL`.
- RLS: SELECT/INSERT/UPDATE فقط برای `auth.uid() = user_id`.

**Edge Function `claim-reading-session`:**
- ورودی: `book_id`, `device_id`.
- اگر session فعال دیگری وجود داشت → آن را released می‌کند، و سپس session جدید می‌سازد. در پاسخ `previous_device_id` برمی‌گردد.
- روی دستگاه قبلی Realtime یا polling سبک (هر ۲۰ ثانیه heartbeat) متوجه می‌شود session‌اش released شده → Reader قفل، پیام نمایش داده می‌شود + دکمه «بازگرداندن به این دستگاه» (که دوباره `claim` می‌زند).

**Realtime:**
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.book_reading_sessions;`
- هر دستگاه به row متعلق به `(user_id, book_id, device_id=self)` گوش می‌دهد؛ تغییر `released_at` → قفل.

**حالت آفلاین:**
- اگر دستگاه offline است و session ندارد → اجازه خواندن آفلاین، اما هنگام آنلاین شدن اگر session توسط دستگاه دیگر گرفته شده باشد، با heartbeat بعدی متوجه می‌شود و قفل می‌شود (بدون از دست رفتن هایلایت‌های ذخیره‌شده محلی).
- تلاش برای claim در حالت آفلاین → اجازه خواندن داده می‌شود ولی با بنر «بدون اتصال — قفل پس از اتصال اعمال می‌شود».

---

## ۵. نسخه‌بندی کتاب (جلوگیری از دانلود مجدد)

migration:
- `books.content_version INTEGER DEFAULT 1`
- `books.content_updated_at TIMESTAMPTZ`
- Trigger: تغییر `pages/cover_url/title/...` → `content_version += 1`.

سمت کلاینت:
- جدول محلی `books_cache(book_id, content_version, downloaded_at, size_bytes, status)`.
- مقایسه نسخه قبل از هر دانلود؛ مساوی → بدون ترافیک.
- بَج «به‌روزرسانی موجود» + دانلود دستی؛ خودکار فقط روی Wi-Fi.
- هایلایت/یادداشت مستقل از `content_version`.
- هرگز downgrade نشود.

---

## ۶. لایه کش — قانون «هرگز مانع به‌روزرسانی نشو»

1. **بدون Service Worker / PWA cache** برای shell اپ → سایت همیشه از شبکه.
2. کش فقط محتوای کتاب در DB رمز شده.
3. متادیتای قفسه TTL ۵ دقیقه + fallback آفلاین.
4. `/version.json` HEAD در هر باز شدن اپ → invalidate متادیتا (نه محتوا).
5. خواندن از کش فقط وقتی آفلاین یا `content_version` مساوی.
6. SWR برای کاور/لیست.
7. منوی «پاک‌سازی کش» در تنظیمات.

---

## ۷. همگام‌سازی هایلایت/یادداشت/پیشرفت

migration روی `highlights`:
- `client_id UUID`, `updated_at TIMESTAMPTZ`, `deleted_at TIMESTAMPTZ`
- ایندکس `(user_id, updated_at)`.

الگوریتم: last-write-wins روی `updated_at` (از سرور). صف Push با retry نمایی (1s, 4s, 16s, 60s).

---

## ۸. فازهای اجرا (مرحله‌به‌مرحله)

| فاز | کار | نیاز به تأیید migration |
|-----|-----|------|
| ۱ | Migration: ستون‌های نسخه‌بندی + جداول `user_offline_devices` و `book_reading_sessions` + ستون‌های sync روی `highlights` + Realtime | ✅ |
| ۲ | Edge Functions: `issue-book-key`, `claim-reading-session`, `release-reading-session` | – |
| ۳ | نصب Capacitor + پلاگین‌ها + `capacitor.config.ts` | – |
| ۴ | `src/lib/offline/` — `db.ts`, `crypto.ts`, `OfflineStore.ts`, `deviceId.ts` | – |
| ۵ | `DeviceManager` UI در Profile + دکمه «دانلود برای آفلاین» در Library | – |
| ۶ | `ReadingLockManager` + ادغام با Reader (heartbeat + Realtime + بنر قفل) | – |
| ۷ | `SyncEngine` + Network listener | – |
| ۸ | تست‌های سناریوهای خرابی (بخش ۹) | – |
| ۹ | مستندات صادرات GitHub + `npx cap add ios/android` | – |

---

## ۹. تست‌های الزامی (Vitest + msw)

پوشه `src/lib/offline/__tests__/`.

**A. قطع اینترنت**
1. کتاب آفلاین + قطع شبکه → Reader کامل باز شود.
2. هایلایت آفلاین → ذخیره با `synced=false` → اتصال مجدد → push.
3. کتاب دانلودنشده + آفلاین → پیام شفاف.
4. قطع وسط دانلود → resume، نه شروع از صفر.

**B. اختلاف نسخه**
5. `content_version` سرور بزرگ‌تر → بَج، Reader از کش قدیمی.
6. به‌روزرسانی → هایلایت‌ها حفظ شوند (گره‌خورده به `page_index + text`).
7. سرور نسخه پایین‌تر → نادیده.
8. کتاب revoke شده → DB محلی پاک، Reader بسته.

**C. شکست همگام‌سازی**
9. ۵۰۳ روی push → retry نمایی، صف persist.
10. تعارض دو دستگاه → برنده `updated_at` بزرگ‌تر، بازنده در `conflicts_log`.
11. دیسک پر → پیام، نه حالت ناقص.
12. کلید پاک‌شده → reset + redownload بدون کرش.
13. تغییر کاربر روی همان دستگاه → DB‌های مستقل.
14. ساعت دستگاه عقب → `updated_at` از سرور.

**D. کپی‌رایت / محدودیت دستگاه (جدید)**
15. کپی DB روی دستگاه دیگر → باز نشدن.
16. تلاش انتخاب/کپی متن → مسدود.
17. دانلود روی دستگاه سوم → 409، نمایش لیست برای آزادسازی.
18. آزادسازی دستگاه → دستگاه سوم می‌تواند دانلود کند.
19. دستگاه آزادشده در sync بعدی → DB پاک شود.

**E. قفل خواندن همزمان (جدید)**
20. باز کردن کتاب در دستگاه B وقتی در A باز است → A پیام «در دستگاه دیگر باز شد» + قفل.
21. دکمه «بازگرداندن به اینجا» در A → B قفل می‌شود.
22. heartbeat هر ۲۰s → اگر ۹۰s نرسید، session سرور stale و قابل claim.
23. آفلاین در A + claim در B → A وقتی آنلاین شد قفل می‌شود؛ هایلایت‌های آفلاین A از دست نروند.
24. بستن tab/اپ → `release-reading-session` با `navigator.sendBeacon`.

**F. کش و به‌روزرسانی سایت**
25. دیپلوی نسخه جدید → بدون clear cache دیده شود (چون SW نداریم).
26. تغییر کاور → پس از TTL یا refresh دیده شود.
27. `content_updated_at` بدون `content_version` → کلاینت دانلود نکند.

---

## ۱۰. تأییدیه‌های مورد نیاز

۱. تأیید migration فاز ۱ (سه جدول/ستون جدید + Realtime).
۲. تأیید Edge Functions فاز ۲.
۳. تأیید: بدون Service Worker.

با گفتن «تأیید می‌کنم migration» فاز ۱ را اجرا می‌کنم. سپس بقیه را پشت سر هم می‌فرستم.
