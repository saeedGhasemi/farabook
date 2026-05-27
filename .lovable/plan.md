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

## افزونه Word (Office Add-in) — مسیر اصلی پذیرفته‌شده

**هدف:** انجام تمام پاک‌سازی و نرمال‌سازی سند *در داخل خود Word*، تا خروجی نهایی
بدون نیاز به importer سنگین، یا مستقیماً به اکانت ناشر آپلود شود، یا به‌صورت یک
فایل `.docx` «تمیز و استاندارد» ذخیره گردد که importer فعلی هم بدون مشکل آن را
بشناسد. (مسیر PDF/HTML کنار گذاشته شد چون خروجی‌ها — تصاویر، ZWNJ، فرمول، dir —
به‌اندازه کافی قابل اعتماد نبود.)

### دامنه پشتیبانی
- Word 2016 / 2019 / 2021 / 2024 / Microsoft 365 (Win + Mac) + Word for the Web.
- ورودی: فقط `.docx` (OOXML). `.doc` قدیمی پشتیبانی نمی‌شود — به کاربر پیام
  داده می‌شود «ابتدا در Word با Save As به `.docx` تبدیل کنید».
- نصب: در Word جدید از طریق manifest XML یا Unified Manifest (M365)؛ برای
  سازمان‌ها Centralized Deployment، برای کاربر تنها "Upload My Add-in".

### معماری
- Taskpane add-in روی مسیر `/word-addin` همین برنامه میزبانی می‌شود.
- ارتباط با Word: Office.js + خواندن مستقیم OOXML خام
  (`context.document.body.getOoxml()` و `getFileAsync(Office.FileType.Compressed)`).
- AST خروجی add-in **دقیقاً منطبق با ساختار فعلی `tiptap-doc.ts`** است؛ هیچ
  مسیر داده موازی ساخته نمی‌شود.

### موتور پاک‌سازی داخل add-in
1. **هدینگ‌های سفارشی → استاندارد** (مورد ۹): خوشه‌بندی استایل‌های پاراگراف بر
   اساس font-size / bold / طول / فاصله، تعیین level نسبی، و *در فایل Word هم*
   استایل پاراگراف‌ها به `Heading 1/2/3` استاندارد بازنویسی می‌شود. خروجی add-in
   تمیز می‌شود و فایل ذخیره‌شده برای importer هم استاندارد.
2. **فهرست مطالب (TOC)**: شناسایی، استخراج (عنوان، صفحه)، و در نبود heading
   استاندارد با کمک خروجی مرحله ۱ سطوح فصل بازسازی می‌شوند.
3. **فرمول‌ها**: OMML → MathML → LaTeX (با `mathml-to-latex`). inline → node
   `math`، نمایشی → block `math`.
4. **sup/sub**: `w:vertAlign` → node `sup`/`sub` (نه Unicode، نه حذف).
5. **ZWNJ / ZWSP**: `\u200C` و `\u200B` حفظ شوند؛ هیچ normalize حذفی روی متن.
6. **جهت متن**: `w:bidi` در `pPr` + heuristic اسکریپت غالب → `dir: "rtl"|"ltr"`
   روی هر پاراگراف.
7. **زبان**: `w:lang` خوانده و در attr پاراگراف ذخیره می‌شود.
8. **تصاویر**: استخراج مستقیم از zip فایل `.docx`؛ EMF/WMF با canvas داخل
   add-in به PNG (همان pipeline فعلی `emf-converter`).
9. **لیست‌ها**: nesting از `w:numPr/w:ilvl` و حفظ نوع شماره‌گذاری
   (decimal/persian/arabic-indic/bullet).
10. **جداول**: colspan/rowspan از `w:gridSpan` و `w:vMerge`.
11. **پاورقی/Endnote**: node `footnote` با مرجع inline.

### پیش‌نمایش داخل add-in
- iframe در taskpane همان `BlockRenderer` وب را رندر می‌کند تا کاربر **قبل از
  ارسال** ببیند خروجی وب چگونه است. اختلاف با Word → اصلاح در Word → preview مجدد.

### دو حالت خروجی
**الف) آپلود مستقیم به اکانت ناشر:**
- ورود به اکانت در taskpane (Supabase auth با dialog API آفیس).
- ارسال AST پاک‌شده + مدیا به edge function جدید `word-addin-ingest` که رکورد
  `books` (status=`draft`) می‌سازد و کاربر به ادیتور ناشر redirect می‌شود.
- نیاز: bucket `book-uploads` موجود، grant سرویس برای `word-addin-ingest`.

**ب) ذخیره فایل Word تمیز (Clean DOCX export):**
- add-in تبدیلات را داخل فایل اعمال می‌کند:
  - بازنویسی استایل پاراگراف‌ها به Heading استاندارد.
  - تبدیل sup/sub دستی به `w:vertAlign` استاندارد.
  - حذف runهای صفر/تکراری و merge کردن runهای هم‌فرمت.
  - نرمال‌سازی لیست‌ها به `w:numPr` استاندارد.
  - نگه‌داری OMML سالم برای فرمول‌ها.
  - تضمین `w:lang` و `w:bidi` صحیح روی پاراگراف‌ها.
- کاربر با دکمه «ذخیره نسخه تمیز» یک `.docx` جدید می‌گیرد که importer فعلی
  `word-import` بدون retry/fallback پردازش می‌کند.
- یک marker مخفی (Custom XML Part با id `farabook-cleaned-v1`) داخل فایل
  درج می‌شود تا `word-import` بفهمد فایل از قبل نرمال شده و مسیر سریع را برود
  (بدون heuristicهای سنگین).

### Edge function جدید `word-addin-ingest`
- ورودی: `{ ast: TiptapDoc, media: { name, contentType, base64 }[], meta }`.
- اعتبارسنجی JWT، آپلود مدیا به `book-media`، ساخت `books` row، برگشت `bookId`.
- `verify_jwt = true` در `supabase/config.toml`.

### ترتیب اجرای add-in (پس از تایید کاربر)
1. اسکلت taskpane + manifest (sideload + AppSource-compatible) + auth.
2. خواننده OOXML + AST mapper (بدون پاک‌سازی).
3. موتور پاک‌سازی کامل (هدینگ، فرمول، sup/sub، ZWNJ، dir، lang، lists، tables، media).
4. پیش‌نمایش زنده با `BlockRenderer`.
5. مسیر آپلود (`word-addin-ingest`) + redirect به ادیتور ناشر.
6. مسیر Clean DOCX export + درج Custom XML marker.
7. تشخیص marker در `word-import` و فعال‌سازی مسیر سریع.

### تست
- روی Word 2019/2021/365/Web با فایل‌های مشکل‌دار قبلی (فارسی/عربی/انگلیسی،
  فرمول شیمی/ریاضی، تصاویر EMF، sup/sub، nested lists، TOC چندسطحی) regression.

---

## یادداشت درباره مسیر PDF/HTML (تست‌شده، کنار گذاشته شد)
- `doc-import` (PDF با `unpdf`، HTML با `linkedom`) ساخته و آپلود شد اما خروجی
  ضعیف بود: تصاویر استخراج نمی‌شدند، ZWNJ از بین می‌رفت، فرمول‌ها و dir درست
  نبودند. این مسیر تا اطلاع ثانوی توسعه نمی‌یابد؛ تمرکز روی add-in Word است.
