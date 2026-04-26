-- =========================================================
-- 1. Extend profiles with optional public/contact fields
-- =========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_profiles_touch ON public.profiles;
CREATE TRIGGER trg_profiles_touch
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 2. book_comments table
-- =========================================================
CREATE TABLE IF NOT EXISTS public.book_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  parent_id uuid REFERENCES public.book_comments(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  rating int CHECK (rating BETWEEN 1 AND 5),
  edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_comments_book ON public.book_comments(book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_book_comments_user ON public.book_comments(user_id);

ALTER TABLE public.book_comments ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_book_comments_touch ON public.book_comments;
CREATE TRIGGER trg_book_comments_touch
BEFORE UPDATE ON public.book_comments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Set edited flag automatically when body changes
CREATE OR REPLACE FUNCTION public.mark_comment_edited()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_book_comments_edited ON public.book_comments;
CREATE TRIGGER trg_book_comments_edited
BEFORE UPDATE ON public.book_comments
FOR EACH ROW EXECUTE FUNCTION public.mark_comment_edited();

-- =========================================================
-- 3. RLS for book_comments
-- =========================================================
DROP POLICY IF EXISTS bc_select_all ON public.book_comments;
CREATE POLICY bc_select_all ON public.book_comments
FOR SELECT USING (true);

DROP POLICY IF EXISTS bc_insert_self ON public.book_comments;
CREATE POLICY bc_insert_self ON public.book_comments
FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS bc_update_own_or_mod ON public.book_comments;
CREATE POLICY bc_update_own_or_mod ON public.book_comments
FOR UPDATE USING (
  auth.uid() = user_id
  OR public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'moderator'::app_role)
);

DROP POLICY IF EXISTS bc_delete_own_or_mod ON public.book_comments;
CREATE POLICY bc_delete_own_or_mod ON public.book_comments
FOR DELETE USING (
  auth.uid() = user_id
  OR public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'moderator'::app_role)
);