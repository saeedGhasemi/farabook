-- Extend books with publishing workflow fields
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS publisher_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS isbn text,
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'fa',
  ADD COLUMN IF NOT EXISTS audience text,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_audio_url text,
  ADD COLUMN IF NOT EXISTS typography_preset text DEFAULT 'editorial',
  ADD COLUMN IF NOT EXISTS preview_pages integer[] DEFAULT '{0}',
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS books_publisher_idx ON public.books(publisher_id);
CREATE INDEX IF NOT EXISTS books_status_idx ON public.books(status);
CREATE INDEX IF NOT EXISTS books_slug_idx ON public.books(slug);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_books_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS books_touch_updated_at ON public.books;
CREATE TRIGGER books_touch_updated_at
BEFORE UPDATE ON public.books
FOR EACH ROW
EXECUTE FUNCTION public.touch_books_updated_at();

-- Replace permissive SELECT with status-aware policy
DROP POLICY IF EXISTS books_select_all ON public.books;

CREATE POLICY books_select_published_or_owner
ON public.books
FOR SELECT
USING (
  status = 'published'
  OR auth.uid() = publisher_id
);

-- Owners can manage their own books (insert / update / delete)
CREATE POLICY books_insert_own
ON public.books
FOR INSERT
WITH CHECK (auth.uid() = publisher_id);

CREATE POLICY books_update_own
ON public.books
FOR UPDATE
USING (auth.uid() = publisher_id);

CREATE POLICY books_delete_own
ON public.books
FOR DELETE
USING (auth.uid() = publisher_id);