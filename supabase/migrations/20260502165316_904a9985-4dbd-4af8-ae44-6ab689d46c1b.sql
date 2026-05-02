
-- 1. Settings (single row)
CREATE TABLE IF NOT EXISTS public.comment_moderation_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  sensitive_words TEXT[] NOT NULL DEFAULT ARRAY[
    'کلاهبردار','فحش','احمق','لعنت','حرومزاده','کصافط','کصافت','کیر','کس','جنده'
  ]::text[],
  block_links BOOLEAN NOT NULL DEFAULT true,
  block_mentions BOOLEAN NOT NULL DEFAULT false,
  auto_hide BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO public.comment_moderation_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.comment_moderation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cms_select_all ON public.comment_moderation_settings;
CREATE POLICY cms_select_all ON public.comment_moderation_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS cms_update_admin ON public.comment_moderation_settings;
CREATE POLICY cms_update_admin ON public.comment_moderation_settings
  FOR UPDATE USING (public.is_admin(auth.uid()));

-- 2. Flag columns on comments
ALTER TABLE public.book_comments
  ADD COLUMN IF NOT EXISTS auto_flagged BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason  TEXT,
  ADD COLUMN IF NOT EXISTS flag_rule    TEXT;

-- 3. Moderation function
CREATE OR REPLACE FUNCTION public.moderate_book_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.comment_moderation_settings%ROWTYPE;
  body_l TEXT := lower(COALESCE(NEW.body,''));
  matched_word TEXT;
  reasons TEXT[] := ARRAY[]::TEXT[];
  rules TEXT[] := ARRAY[]::TEXT[];
  pub_id UUID;
  b_title TEXT;
BEGIN
  SELECT * INTO s FROM public.comment_moderation_settings WHERE id = 1;
  IF s IS NULL THEN RETURN NEW; END IF;

  -- Link rule
  IF s.block_links AND body_l ~* '(https?://|www\.[a-z0-9]|[a-z0-9.-]+\.(com|net|org|ir|io|co|xyz|info|me))' THEN
    reasons := array_append(reasons, 'حاوی لینک');
    rules := array_append(rules, 'link');
  END IF;

  -- Mention rule
  IF s.block_mentions AND NEW.body ~ '(^|\s)@[A-Za-z0-9_]{2,}' THEN
    reasons := array_append(reasons, 'حاوی منشن کاربر');
    rules := array_append(rules, 'mention');
  END IF;

  -- Sensitive words
  IF s.sensitive_words IS NOT NULL THEN
    FOREACH matched_word IN ARRAY s.sensitive_words LOOP
      IF length(trim(matched_word)) > 0
         AND position(lower(matched_word) in body_l) > 0 THEN
        reasons := array_append(reasons, 'کلمه حساس: ' || matched_word);
        rules := array_append(rules, 'sensitive');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF array_length(reasons, 1) IS NOT NULL THEN
    NEW.auto_flagged := true;
    NEW.flag_reason  := array_to_string(reasons, ' • ');
    NEW.flag_rule    := array_to_string(rules, ',');
    IF s.auto_hide THEN
      NEW.is_hidden := true;
    END IF;

    -- Notify publisher (only on INSERT)
    IF TG_OP = 'INSERT' THEN
      SELECT publisher_id, title INTO pub_id, b_title
        FROM public.books WHERE id = NEW.book_id;
      IF pub_id IS NOT NULL AND pub_id <> NEW.user_id THEN
        INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
        VALUES (
          pub_id,
          'comment_flagged',
          'یک نظر به‌صورت خودکار علامت‌گذاری شد',
          'نظری روی کتاب «' || COALESCE(b_title,'') || '» نیاز به بررسی دارد. دلیل: ' || NEW.flag_reason,
          '/publisher',
          jsonb_build_object('book_id', NEW.book_id, 'comment_id', NEW.id, 'reason', NEW.flag_reason)
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moderate_book_comment_ins ON public.book_comments;
CREATE TRIGGER trg_moderate_book_comment_ins
  BEFORE INSERT ON public.book_comments
  FOR EACH ROW EXECUTE FUNCTION public.moderate_book_comment();

DROP TRIGGER IF EXISTS trg_moderate_book_comment_upd ON public.book_comments;
CREATE TRIGGER trg_moderate_book_comment_upd
  BEFORE UPDATE OF body ON public.book_comments
  FOR EACH ROW EXECUTE FUNCTION public.moderate_book_comment();
