# برنامه اجرا (به‌روزرسانی‌شده — فعلاً اجرا نشود)

این برنامه آماده است اما بنا به درخواست کاربر فعلاً متوقف است
(به‌خاطر مشکلات importer فعلی روی فایل‌های Word جدید).
ابتدا گزینه‌ی ورود از PDF / HTML اضافه و تست می‌شود؛ وقتی پایدار شد،
موارد زیر یکی‌یکی اجرا می‌شوند.

این درخواست شامل ۹ تغییر مستقل است.

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

## ۹. شناسایی هدینگ‌های سفارشی و نگاشت به هدینگ استاندارد (مورد جدید)
**هدف:** بعضی کاربران به‌جای استفاده از Heading 1/2/3 استاندارد Word، استایل‌های شخصی
(فونت بزرگ‌تر، Bold، رنگ، فاصله بالا/پایین، شماره‌گذاری دستی) را برای عناوین فصل
و سرتیتر به کار می‌برند. این پاراگراف‌ها در importer به‌عنوان «پاراگراف معمولی»
دیده می‌شوند و ساختار فصل‌بندی از بین می‌رود.

**رویکرد در `word-import`:**
- در فاز اسکن `styles.xml` و `numbering.xml`، پروفایل تمام style‌های پاراگرافی استفاده‌شده
  (font-size، bold، رنگ، outline-level، فاصله قبل/بعد، ind/jc) جمع‌آوری شود.
- خوشه‌بندی (heuristic clustering): پاراگراف‌ها بر اساس امضای استایل گروه‌بندی شوند.
  هر خوشه با ویژگی‌هایی مثل «بزرگ‌تر از متن بدنه + Bold + کوتاه (<۱۲۰ کاراکتر) + در ابتدای صفحه/پاراگراف منفرد»
  امتیاز "heading-likelihood" می‌گیرد.
- ترتیب اندازه فونت بین خوشه‌های heading-like → تعیین level نسبی
  (بزرگ‌ترین = H1، بعدی = H2، …).
- این نگاشت قبل از تبدیل به Block‌ها اعمال شود: پاراگراف خوشه‌ی level N به
  `{type: "heading", level: N, text}` تبدیل شود، حتی اگر در XML نام style او
  «Normal» یا یک نام دلخواه باشد.
- خروجی این مرحله ورودی **فاز ۸ (TOC + nested chaptering)** می‌شود — یعنی همان
  الگوریتم چاپتر‌بندی روی همین heading‌های بازسازی‌شده اجرا می‌شود.
- لاگ تشخیصی: تعداد پاراگراف‌های ارتقا یافته به heading و توزیع سطوح،
  در پاسخ edge function برگردانده شود تا در UI پس از import به کاربر گزارش شود
  («۲۴ سرتیتر سفارشی شناسایی و به ۳ سطح فصل تبدیل شد»).

## ترتیب اجرا
1. ZWNJ + sticky toolbar + sup/sub/math toolbar buttons (ادیتور UI)
2. اصلاح word-import: ZWNJ preserve، OMML→LaTeX، sup/sub، code، **heading-style detection (مورد ۹)** → سپس TOC-based nested chapters
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
- Heading-style detection: استفاده از خود `styles.xml` + ویژگی‌های runProperties هر پاراگراف.
  پاراگراف‌های با amplitude بصری زیاد (نسبت font-size به median بدنه > 1.25 یا Bold/Uppercase + طول کوتاه)
  کاندیدای heading شوند. باید روی نمونه‌های واقعی کاربر کالیبره شود.

این برنامه بزرگ است؛ بعد از تایید مجدد کاربر (پس از تثبیت مسیر PDF/HTML) همه را پشت سر هم اجرا می‌کنم.

---

## مرحله مقدم (در حال اجرا الان): ورود از PDF و HTML
- edge function جدید `doc-import` که فایل PDF یا HTML را به ساختار pages/blocks
  تبدیل می‌کند و کتابی در حالت draft می‌سازد (مشابه خروجی word-import).
- در `Upload.tsx` یک تب/گزینه‌ی جدید «از PDF یا HTML» اضافه شود.
- PDF: متن هر صفحه با `unpdf` استخراج و به یک Page تبدیل می‌شود.
- HTML: ساختار `<h1>..<h6>`, `<p>`, `<ul>/<ol>`, `<blockquote>`, `<img>`, `<table>`, `<pre>` به Blockها نگاشت
  و هر `<h1>` شروع یک Page است.
- خروجی هر دو در همان ادیتور فعلی باز می‌شود تا کیفیت parse را تست کنیم.
