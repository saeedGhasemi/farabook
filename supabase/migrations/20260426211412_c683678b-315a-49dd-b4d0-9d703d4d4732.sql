-- 1) Reassign 6 books away from the test publisher (keep only the first 3)
UPDATE public.books
SET publisher_id = NULL
WHERE publisher_id = 'fc845bec-12d4-4da2-a1c5-2411cbf76253'
  AND id NOT IN (
    '6fd59d85-62a4-4f6c-841b-fb0371cfea55',
    'f01dbc2f-9a16-4fad-bcd4-c6dfe8cb7843',
    'bbdf7d2a-44bf-4043-907c-94e39743649b'
  );

-- 2) Notify publisher when a comment is posted on their book
CREATE OR REPLACE FUNCTION public.notify_publisher_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pub_id UUID;
  b_title TEXT;
  commenter_name TEXT;
BEGIN
  SELECT publisher_id, title INTO pub_id, b_title FROM public.books WHERE id = NEW.book_id;
  IF pub_id IS NULL OR pub_id = NEW.user_id THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(display_name, 'کاربر') INTO commenter_name FROM public.profiles WHERE id = NEW.user_id;
  INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
  VALUES (
    pub_id,
    'new_comment',
    'نظر جدید روی کتاب شما',
    commenter_name || ' روی کتاب «' || COALESCE(b_title, '') || '» نظر داد: ' ||
      CASE WHEN length(NEW.body) > 120 THEN substr(NEW.body, 1, 120) || '…' ELSE NEW.body END,
    '/read/' || NEW.book_id::text,
    jsonb_build_object('book_id', NEW.book_id, 'comment_id', NEW.id, 'commenter_id', NEW.user_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_publisher_on_comment ON public.book_comments;
CREATE TRIGGER trg_notify_publisher_on_comment
AFTER INSERT ON public.book_comments
FOR EACH ROW
EXECUTE FUNCTION public.notify_publisher_on_comment();