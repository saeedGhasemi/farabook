-- Add back cover and spread cover support to books
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS back_cover_url TEXT,
  ADD COLUMN IF NOT EXISTS back_cover_focus JSONB DEFAULT '{"x": 50, "y": 50}'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_spread_url TEXT,
  ADD COLUMN IF NOT EXISTS cover_crop JSONB;

-- Update content version trigger to also react to back/spread cover changes
CREATE OR REPLACE FUNCTION public.bump_book_content_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pages IS DISTINCT FROM OLD.pages
       OR NEW.cover_url IS DISTINCT FROM OLD.cover_url
       OR NEW.back_cover_url IS DISTINCT FROM OLD.back_cover_url
       OR NEW.cover_spread_url IS DISTINCT FROM OLD.cover_spread_url
       OR NEW.cover_crop IS DISTINCT FROM OLD.cover_crop
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.subtitle IS DISTINCT FROM OLD.subtitle
       OR NEW.description IS DISTINCT FROM OLD.description THEN
      NEW.content_version := COALESCE(OLD.content_version, 1) + 1;
      NEW.content_updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;