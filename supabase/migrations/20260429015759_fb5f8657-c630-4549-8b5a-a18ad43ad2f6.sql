CREATE TABLE public.word_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT 'کتاب جدید',
  author TEXT NOT NULL DEFAULT 'ناشناس',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  last_error TEXT,
  book_id UUID,
  chapters_count INTEGER,
  images_count INTEGER,
  skipped_images_count INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX word_imports_user_idx ON public.word_imports(user_id, created_at DESC);

ALTER TABLE public.word_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wi_select_own_or_admin" ON public.word_imports
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "wi_insert_own" ON public.word_imports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wi_update_own_or_admin" ON public.word_imports
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "wi_delete_own_or_admin" ON public.word_imports
  FOR DELETE USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE TRIGGER word_imports_touch_updated_at
  BEFORE UPDATE ON public.word_imports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();