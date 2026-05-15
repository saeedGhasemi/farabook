-- 1) Book content versioning
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.bump_book_content_version()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pages IS DISTINCT FROM OLD.pages
       OR NEW.cover_url IS DISTINCT FROM OLD.cover_url
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.subtitle IS DISTINCT FROM OLD.subtitle
       OR NEW.description IS DISTINCT FROM OLD.description THEN
      NEW.content_version := COALESCE(OLD.content_version, 1) + 1;
      NEW.content_updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_book_content_version ON public.books;
CREATE TRIGGER trg_bump_book_content_version
BEFORE UPDATE ON public.books
FOR EACH ROW EXECUTE FUNCTION public.bump_book_content_version();

-- 2) Offline devices (max 2 enforced in edge function)
CREATE TABLE IF NOT EXISTS public.user_offline_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  platform TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_id)
);

ALTER TABLE public.user_offline_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY uod_select_own ON public.user_offline_devices
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY uod_insert_own ON public.user_offline_devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY uod_update_own ON public.user_offline_devices
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY uod_delete_own ON public.user_offline_devices
  FOR DELETE USING (auth.uid() = user_id);

-- 3) Reading sessions (single-device-at-a-time per book)
CREATE TABLE IF NOT EXISTS public.book_reading_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  device_label TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  released_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS brs_one_active_per_book
  ON public.book_reading_sessions (user_id, book_id)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS brs_user_book_idx
  ON public.book_reading_sessions (user_id, book_id, last_heartbeat_at DESC);

ALTER TABLE public.book_reading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_reading_sessions REPLICA IDENTITY FULL;

CREATE POLICY brs_select_own ON public.book_reading_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY brs_insert_own ON public.book_reading_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY brs_update_own ON public.book_reading_sessions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY brs_delete_own ON public.book_reading_sessions
  FOR DELETE USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.book_reading_sessions;

-- 4) Highlights sync columns
ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS client_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS highlights_user_updated_idx
  ON public.highlights (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.touch_highlights_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_highlights_updated_at ON public.highlights;
CREATE TRIGGER trg_touch_highlights_updated_at
BEFORE UPDATE ON public.highlights
FOR EACH ROW EXECUTE FUNCTION public.touch_highlights_updated_at();