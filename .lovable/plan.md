# برنامه اجرا

این درخواست شامل ۸ تغییر مستقل است. به ترتیب اولویت و وابستگی اجرا می‌شوند.

## ۱. پشتیبانی Zero-Width Space (ZWNJ) در متون فارسی
- در `word-import` edge function: کاراکتر `\u200C` (ZWNJ) و `\u200B` (ZWSP) را در متن استخراج‌شده از Word حفظ کن (الان احتمالاً strip می‌شوند).
- در `TextBookEditor` یک دکمه toolbar جدید «نیم‌فاصله» اضافه کن که در نقطه cursor یک `\u200C` درج کند.
- میانبر `Shift+Space` هم برای راحتی.

## ۲. Toolbar چسبان (sticky) با دکمه‌های ذخیره / دستیار AI / مرور تصاویر
- toolbar اصلی ادیتور را `sticky top-0 z-40` کن.
- دکمه‌های Save، AI Suggest، Image Review را داخل همان toolbar (یا یک نوار ثانویه چسبان) قرار بده تا با اسکرول در دسترس بمانند.

## ۳. تشخیص فرمول‌های شیمیایی / ریاضی / کد در ورود از Word
- در `word-import`:
  - تشخیص OMML (Office Math) و تبدیل به LaTeX → ذخیره به‌صورت node `math`.
  - تشخیص `vertAlign="superscript"|"subscript"` در runها و تبدیل به `<sup>` / `<sub>` به‌جای کروشه.
  - تشخیص الگوهای فرمول شیمیایی ساده (مثل `H2O`، `CO2`، `U-235`) با regex روی متن: عدد بعد از حرف بزرگ → subscript؛ `^number` → superscript.
  - تشخیص بلاک‌های code (style `HTML Code`, `Source Code`, یا font monospace) → node `code_block`.
- در ادیتور tiptap nodes برای `sup`, `sub`, `math`, `code_block` فعال‌اند؛ دکمه‌های toolbar برای superscript/subscript/inline-code/math اضافه کن.

## ۴. تنظیم نمایش جلد کتاب (thumbnail crop vs full)
- در `BookMetadataForm`: فیلد جدید `cover_focus` (x,y درصدی) + پیش‌نمایش thumbnail.
- در `BookCover` (thumbnail): از `object-position` بر اساس `cover_focus` استفاده کن.
- در `BookPreviewDialog` در بخش توضیحات: تصویر کامل جلد را با `object-contain` نمایش بده.
- migration: ستون `cover_focus jsonb` به جدول `books`.

## ۵. بازتولید عکس AI (آخرین درخواست ناموفق)
- در `book-image-gen` و `useAutoCover`: retry logic با fallback مدل، و لاگ خطا. بررسی edge function logs برای دلیل عدم تولید قبلی.

## ۶. حفظ پیشنهادهای AI روی صفحه تا درخواست صریح کاربر
- در `AiSuggestPanel`: پیشنهادها را در `localStorage` به ازای `bookId+pageIndex+contentHash` cache کن.
- وقتی کاربر روی صفحه برمی‌گردد، اگر hash تغییر نکرده → پیشنهادهای cached را نشان بده، اعتبار AI مصرف نکن.
- اگر متن یک پاراگراف تغییر کرد → فقط پیشنهادهای مربوط به همان پاراگراف (با range/anchor) را invalidate کن، بقیه باقی بمانند.
- دکمه صریح «تولید مجدد پیشنهادها» اضافه کن.

## ۷. اصلاح هایلایت‌ها
- علت: ذخیره هایلایت با selector متنی → همه تکرارها match می‌شوند.
- تغییر به ذخیره موقعیت دقیق: `pageIndex + blockIndex + charStart + charEnd` (یا ProseMirror position range).
- در render: فقط همان range را علامت بزن (نه همه تکرارها).
- در کلیک روی هایلایت از لیست: navigate به page → scroll به element با `scrollIntoView({block:'start'})` → flash توگل (animation روشن/خاموش یک‌بار).

## ۸. تشخیص فصل‌بندی nested از روی فهرست (TOC)
- در `word-import`:
  - فاز ۱: صفحات اول کتاب را برای کلمات کلیدی «فهرست مطالب» / «Contents» اسکن کن.
  - استخراج جفت‌های (عنوان، شماره صفحه) از TOC.
  - فاز ۲: در ادامه متن، عناوین را با fuzzy match پیدا کن و سطح nesting را از TOC استنباط کن (تورفتگی یا شماره‌گذاری 1، 1.1، 1.1.1).
  - ذخیره ساختار درختی فصل‌ها به‌صورت `{title, level, pageIndex, children[]}`.
- در `ChapterSidebar`: رندر tree با indent بر اساس level.
- در ادیتور: امکان drag یا تغییر level فصل.

## ترتیب اجرا
1. ZWNJ + sticky toolbar + sup/sub/math toolbar buttons (ادیتور UI)
2. اصلاح word-import: ZWNJ preserve، OMML→LaTeX، sup/sub، code، TOC-based nested chapters
3. cover_focus (migration + UI)
4. AI suggest caching + paragraph-level invalidation
5. Highlight position-based + scroll/flash
6. Image gen retry
7. bump version

## جزئیات فنی کلیدی
- ZWNJ regex: متن را normalize نکن — `\u200C`/`\u200B` را whitelist کن.
- OMML→LaTeX: کتابخانه سبک یا تبدیل دستی برای الگوهای پرکاربرد (کسر، توان، رادیکال).
- TOC detection: regex `/^(فهرست\s*مطالب|Contents|Table of Contents)\s*$/im` + الگوی خط `عنوان ........ 12` با leader dots.
- Highlight schema: migration برای افزودن `block_index`, `char_start`, `char_end` به `highlights`. مهاجرت داده‌های قدیمی با fallback.
- cover_focus default: `{x:50,y:50}`.

این برنامه بزرگ است؛ پس از تایید همه را پشت سر هم بدون توقف اجرا می‌کنم.