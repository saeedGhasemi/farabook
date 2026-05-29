# جلد جلو و پشت برای کتاب

## هدف
- کتاب در ابتدا با **جلد جلو** و در انتها با **جلد پشت** نمایش داده شود.
- در پنل تنظیمات، دو راه پشتیبانی شود:
  1. آپلود دو تصویر جداگانه (جلو و پشت)
  2. آپلود یک تصویر گسترده (دوقسمتی) با ابزار **انتخاب ناحیه** (crop) جداگانه برای هر بخش
- نمایش در کتاب‌خوان: صفحه ویژه با افکت **page-flip 3D**.

## مدل داده (مهاجرت)

به جدول `books` اضافه می‌شود:
- `back_cover_url TEXT NULL` — URL جلد پشت (اگر null باشد یعنی پشت ندارد).
- `back_cover_focus JSONB NULL` — مشابه `cover_focus` ولی برای پشت.
- `cover_spread_url TEXT NULL` — اگر کاربر تصویر دوقسمتی آپلود کرد، URL منبع اینجا ذخیره می‌شود.
- `cover_crop JSONB NULL` — `{ front?: {x,y,w,h}, back?: {x,y,w,h} }` به درصد (۰-۱۰۰) برای ناحیه‌های انتخاب‌شده از تصویر spread. وقتی پر است، `cover_url`/`back_cover_url` می‌توانند تصویر spread باشند و نمایش با CSS `object-position`/`object-fit + clip` انجام شود.

داده‌های موجود: کاور فعلی همان جلد جلو می‌ماند، `back_cover_url` خالی.

## UI — ویرایش کاور

کامپوننت جدید `src/components/book-metadata/CoverEditor.tsx`:
- **Tabs**: «دو تصویر جداگانه» | «یک تصویر دوقسمتی»
- حالت ۱:
  - دو ناحیه drop/upload (جلو، پشت)
  - برای هر کدام picker نقطه فوکوس (object-position) — مثل الان
- حالت ۲:
  - یک ناحیه upload برای تصویر spread
  - دو مستطیل crop قابل drag (جلو و پشت) روی تصویر با پیش‌نمایش زنده دو ستون
- پیش‌نمایش زنده: دو کارت کنار هم با نسبت 2:3
- جایگزین قسمت کاور در `BookMetadataForm.tsx` و `Publish.tsx` می‌شود.

## نمایش در کتاب‌خوان

کامپوننت جدید `src/components/reader/CoverPage.tsx`:
- یک صفحه تمام‌صفحه با انیمیشن 3D page-flip (CSS `transform: rotateY` + `transform-style: preserve-3d` + `perspective`).
- در ورود به کتاب: فلیپ از حالت بسته به باز.
- در آخرین صفحه: دکمه «پایان» با فلیپ به جلد پشت.

تغییرات `src/pages/Reader.tsx`:
- ایندکس صفحات: page 0 = front cover (مجازی)، page N+1 = back cover.
- وقتی `back_cover_url` null است، فقط صفحه پایانی ساده با همان جلد جلو + متن «پایان» نشان داده شود.
- ناوبری صفحه (next/prev) این دو صفحه را شامل شود.

## رندر تصویر با crop

کامپوننت کمکی `<CoverImage side="front|back" book={...} />`:
- اگر `cover_crop` موجود است → از `cover_spread_url` با inline style `object-fit:cover; transform: scale + translate` یا `clip-path: inset()` ناحیه را نمایش می‌دهد.
- در غیر این صورت → `cover_url` یا `back_cover_url` با focus point.

## فایل‌های تأثیرپذیر

- migration جدید (افزودن ۴ ستون)
- `src/components/book-metadata/CoverEditor.tsx` (جدید)
- `src/components/book-metadata/BookMetadataForm.tsx`
- `src/components/reader/CoverPage.tsx` (جدید)
- `src/components/store/BookCover.tsx` (پشتیبانی از crop)
- `src/pages/Reader.tsx` (افزودن صفحات جلد به ناوبری)
- `src/pages/Edit.tsx`, `src/pages/Publish.tsx` (select کردن ستون‌های جدید)
- `src/lib/offline/assetWalker.ts` (کش کردن back_cover_url و cover_spread_url)
- `src/lib/version.ts` + `public/version.json` bump

## خارج از این تغییر
- کارت کتاب در فروشگاه/کتابخانه همان جلد جلو را نشان می‌دهد (بدون تغییر).
- تولید خودکار جلد پشت با AI — می‌تواند فاز بعدی باشد.
