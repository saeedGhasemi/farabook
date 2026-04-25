import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Lang = "fa" | "en";
type Dict = Record<string, { fa: string; en: string }>;

const dict: Dict = {
  brand: { fa: "کتاب‌خانه", en: "Bookhane" },
  tagline: { fa: "تجربه‌ای نو از خواندن", en: "A new way to read" },
  hero_title: { fa: "کتاب‌ها زنده می‌شوند", en: "Where books come alive" },
  hero_sub: { fa: "سامانه کتاب دیجیتال تعاملی با هوش مصنوعی، صدای محیطی و تجربه ورق زدن سه‌بعدی", en: "Interactive digital books with AI, ambient sound and 3D page-turning" },
  cta_start: { fa: "شروع کنید", en: "Get Started" },
  cta_explore: { fa: "کاوش کتاب‌ها", en: "Explore Books" },
  nav_home: { fa: "خانه", en: "Home" },
  nav_library: { fa: "قفسه من", en: "My Library" },
  nav_store: { fa: "فروشگاه", en: "Store" },
  nav_builder: { fa: "کتاب‌ساز", en: "Builder" },
  nav_publisher: { fa: "انتشارات من", en: "My Publishing" },
  nav_signin: { fa: "ورود", en: "Sign in" },
  nav_signout: { fa: "خروج", en: "Sign out" },
  pub_dashboard: { fa: "داشبورد ناشر", en: "Publisher Dashboard" },
  pub_my_books: { fa: "کتاب‌های من", en: "My Books" },
  pub_new: { fa: "کتاب جدید", en: "New Book" },
  pub_drafts: { fa: "پیش‌نویس‌ها", en: "Drafts" },
  pub_published: { fa: "منتشرشده‌ها", en: "Published" },
  pub_readers: { fa: "خوانندگان", en: "Readers" },
  pub_total: { fa: "کل کتاب‌ها", en: "Total books" },
  pub_visit_store: { fa: "ویترین عمومی", en: "Public storefront" },
  pub_no_books: { fa: "هنوز کتابی نساخته‌اید", en: "You haven't created any book yet" },
  hot_books: { fa: "داغ‌ترین کتاب‌ها", en: "Hottest books" },
  hot_sub: { fa: "بیشترین خواننده‌ها در سامانه", en: "Most-read on the platform" },
  fresh_books: { fa: "تازه‌منتشرشده‌ها", en: "Fresh releases" },
  fresh_sub: { fa: "جدیدترین آثار ناشران", en: "Newest publisher works" },
  categories_title: { fa: "دسته‌بندی‌های موضوعی", en: "Browse by category" },
  top_publishers: { fa: "ناشران فعال", en: "Active publishers" },
  featured_label: { fa: "کتاب ویژه هفته", en: "Book of the week" },
  see_all: { fa: "همه", en: "See all" },
  readers_count: { fa: "خواننده", en: "readers" },
  books_count: { fa: "کتاب", en: "books" },
  feat_title: { fa: "ویژگی‌های منحصربه‌فرد", en: "Signature features" },
  f_ai: { fa: "خلاصه‌سازی هوشمند", en: "Smart AI summaries" },
  f_ai_d: { fa: "هر فصل را با یک کلیک خلاصه و آزمون بسازید", en: "Summarize and quiz every chapter in one click" },
  f_ambient: { fa: "حالت محیطی", en: "Ambient reading" },
  f_ambient_d: { fa: "صدای باران، جنگل، کافه و نور رنگی متناسب با ژانر", en: "Rain, forest, café sounds with mood lighting" },
  f_flip: { fa: "ورق زدن سه‌بعدی", en: "3D page turn" },
  f_flip_d: { fa: "تجربه‌ای واقعی شبیه کتاب فیزیکی", en: "Feels like a real physical book" },
  f_voice: { fa: "دستیار صوتی", en: "Voice narration" },
  f_voice_d: { fa: "خواندن طبیعی AI با هایلایت کلمه به کلمه", en: "Natural AI voice with word-by-word highlight" },
  f_share: { fa: "اشتراک امن", en: "Secure sharing" },
  f_share_d: { fa: "بخش‌هایی از کتاب را امانت دهید بدون کپی", en: "Lend snippets without copy risks" },
  f_gamify: { fa: "گیمیفیکیشن", en: "Gamification" },
  f_gamify_d: { fa: "نشان، درخت دانش و چالش‌های سریع", en: "Badges, knowledge trees and flash challenges" },
  library_title: { fa: "قفسه من", en: "My Library" },
  library_empty: { fa: "هنوز کتابی در قفسه ندارید", en: "Your library is empty" },
  library_browse: { fa: "به فروشگاه بروید", en: "Browse store" },
  store_title: { fa: "فروشگاه کتاب", en: "Book Store" },
  search_ph: { fa: "جستجو در کتاب‌ها...", en: "Search books..." },
  buy: { fa: "افزودن به قفسه", en: "Add to library" },
  free: { fa: "رایگان", en: "Free" },
  added: { fa: "به قفسه اضافه شد", en: "Added to library" },
  read: { fa: "مطالعه", en: "Read" },
  by: { fa: "نوشته", en: "by" },
  toman: { fa: "تومان", en: "T" },
  status_unread: { fa: "نخوانده", en: "Unread" },
  status_reading: { fa: "در حال خواندن", en: "Reading" },
  status_finished: { fa: "تمام شده", en: "Finished" },
  back: { fa: "بازگشت", en: "Back" },
  prev: { fa: "قبلی", en: "Previous" },
  next: { fa: "بعدی", en: "Next" },
  page: { fa: "صفحه", en: "Page" },
  ai_summary: { fa: "خلاصهٔ هوشمند", en: "AI Summary" },
  ai_quiz: { fa: "آزمون مفهومی", en: "Quiz" },
  ai_mindmap: { fa: "نقشهٔ ذهنی", en: "Mind Map" },
  ai_explain: { fa: "توضیح ساده", en: "Explain" },
  ai_loading: { fa: "در حال پردازش...", en: "Generating..." },
  ambient: { fa: "صدای محیطی", en: "Ambient" },
  none: { fa: "خاموش", en: "Off" },
  font_size: { fa: "اندازه فونت", en: "Font size" },
  highlight: { fa: "هایلایت", en: "Highlight" },
  listen: { fa: "گوش دادن", en: "Listen" },
  stop: { fa: "توقف", en: "Stop" },
  light: { fa: "روشن", en: "Light" },
  dark: { fa: "تاریک", en: "Dark" },
  settings: { fa: "تنظیمات", en: "Settings" },
  amb_off: { fa: "خاموش", en: "Off" },
  amb_rain: { fa: "باران", en: "Rain" },
  amb_forest: { fa: "جنگل", en: "Forest" },
  amb_cafe: { fa: "کافه", en: "Café" },
  amb_night: { fa: "شب", en: "Night" },
  reading_speed: { fa: "سرعت خواندن", en: "Voice speed" },
  email: { fa: "ایمیل", en: "Email" },
  password: { fa: "رمز عبور", en: "Password" },
  signin: { fa: "ورود", en: "Sign in" },
  signup: { fa: "ثبت‌نام", en: "Sign up" },
  switch_signup: { fa: "حساب ندارید؟ ثبت‌نام", en: "No account? Sign up" },
  switch_signin: { fa: "حساب دارید؟ ورود", en: "Have an account? Sign in" },
  welcome_back: { fa: "خوش آمدید", en: "Welcome back" },
  create_account: { fa: "حساب جدید", en: "Create account" },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof typeof dict) => string;
  dir: "rtl" | "ltr";
}

const Ctx = createContext<I18nCtx | null>(null);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "fa");
  const dir = lang === "fa" ? "rtl" : "ltr";
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem("lang", lang);
  }, [lang, dir]);
  const setLang = (l: Lang) => setLangState(l);
  const t = (key: keyof typeof dict) => dict[key]?.[lang] ?? String(key);
  return <Ctx.Provider value={{ lang, setLang, t, dir }}>{children}</Ctx.Provider>;
};

export const useI18n = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be inside I18nProvider");
  return c;
};
