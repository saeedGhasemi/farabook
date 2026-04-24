-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  credits NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Books catalog
CREATE TABLE public.books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  title_en TEXT,
  author TEXT NOT NULL,
  publisher TEXT,
  category TEXT,
  cover_url TEXT,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  ambient_theme TEXT DEFAULT 'paper',
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "books_select_all" ON public.books FOR SELECT USING (true);

-- User library (owned, borrowed, lent)
CREATE TABLE public.user_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unread', -- unread, reading, finished
  progress NUMERIC NOT NULL DEFAULT 0,
  current_page INT NOT NULL DEFAULT 0,
  acquired_via TEXT NOT NULL DEFAULT 'purchase', -- purchase, borrow, resale
  lent_to UUID REFERENCES auth.users,
  lent_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, book_id)
);
ALTER TABLE public.user_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ub_select_own" ON public.user_books FOR SELECT USING (auth.uid() = user_id OR auth.uid() = lent_to);
CREATE POLICY "ub_insert_own" ON public.user_books FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ub_update_own" ON public.user_books FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "ub_delete_own" ON public.user_books FOR DELETE USING (auth.uid() = user_id);

-- Highlights
CREATE TABLE public.highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.books ON DELETE CASCADE,
  page_index INT NOT NULL,
  text TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  note TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hl_select" ON public.highlights FOR SELECT USING (auth.uid() = user_id OR is_public = true);
CREATE POLICY "hl_insert_own" ON public.highlights FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hl_update_own" ON public.highlights FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "hl_delete_own" ON public.highlights FOR DELETE USING (auth.uid() = user_id);

-- Auto profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed sample books
INSERT INTO public.books (title, title_en, author, publisher, category, cover_url, description, price, ambient_theme, pages) VALUES
('بوف کور', 'The Blind Owl', 'صادق هدایت', 'نشر امیرکبیر', 'ادبیات', 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=600', 'شاهکار ادبیات مدرن فارسی', 0, 'night', 
'[{"title":"فصل اول","content":"در زندگی زخم‌هایی هست که مثل خوره روح را آهسته در انزوا می‌خورد و می‌تراشد. این دردها را نمی‌شود به کسی اظهار کرد..."},{"title":"فصل دوم","content":"همیشه می‌ترسیدم که فردا بیاید و من از این بستر بلند بشوم و خودم را در آینه ببینم. آینه‌ها همیشه به من حقیقتی را نشان داده‌اند..."},{"title":"فصل سوم","content":"شب آرام و سنگین، مثل پرده‌ای از مخمل سیاه روی شهر افتاده بود. نسیم خنکی از پنجره می‌وزید..."}]'::jsonb),
('شازده کوچولو', 'The Little Prince', 'آنتوان دو سنت اگزوپری', 'نشر قطره', 'کودک و نوجوان', 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600', 'داستانی شاعرانه از سفر یک شاهزاده کوچک', 45000, 'forest',
'[{"title":"دیدار","content":"وقتی شش ساله بودم در کتابی به نام داستان‌های واقعی تصویر زیبایی دیدم. تصویری از یک مار بوآ که داشت حیوانی را می‌بلعید..."},{"title":"سیاره B-612","content":"شازده کوچولو از سیاره‌ای آمده بود به اندازه یک خانه. سیاره‌ای که فقط سه آتشفشان داشت و یک گل سرخ..."}]'::jsonb),
('کیمیاگر', 'The Alchemist', 'پائولو کوئیلو', 'نشر کاروان', 'ادبیات', 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=600', 'سفر معنوی یک چوپان به دنبال گنج', 60000, 'cafe',
'[{"title":"رویا","content":"سانتیاگو چوپان جوانی بود که خوابی عجیب می‌دید. خوابی که او را به سفری بزرگ فرا می‌خواند..."},{"title":"صحرا","content":"در دل صحرا، باد رازهایی را زمزمه می‌کرد که تنها قلب‌های پاک می‌توانستند بشنوند..."}]'::jsonb),
('قلعه حیوانات', 'Animal Farm', 'جورج اورول', 'نشر ماهی', 'ادبیات سیاسی', 'https://images.unsplash.com/photo-1589998059171-988d887df646?w=600', 'تمثیلی درخشان از قدرت و فساد', 55000, 'rain',
'[{"title":"شورش","content":"حیوانات مزرعه تصمیم گرفتند علیه آقای جونز قیام کنند. این آغاز انقلابی بود که تاریخ مزرعه را برای همیشه تغییر داد..."}]'::jsonb);