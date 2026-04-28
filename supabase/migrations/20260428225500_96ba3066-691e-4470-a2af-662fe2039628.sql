DO $$
DECLARE
  rec RECORD;
  new_pages JSONB;
  page_idx INT;
  block_idx INT;
  page_obj JSONB;
  block_obj JSONB;
  blocks JSONB;
  txt TEXT;
  new_txt TEXT;
  btype TEXT;
  url_re CONSTANT TEXT := '(https?://[^\s<>"''\)\]]+)';
BEGIN
  FOR rec IN SELECT id, pages FROM public.books WHERE pages::text ~ 'https?://' LOOP
    new_pages := rec.pages;
    IF jsonb_typeof(new_pages) <> 'array' THEN CONTINUE; END IF;

    FOR page_idx IN 0 .. jsonb_array_length(new_pages) - 1 LOOP
      page_obj := new_pages -> page_idx;
      blocks := page_obj -> 'blocks';
      IF blocks IS NULL OR jsonb_typeof(blocks) <> 'array' THEN CONTINUE; END IF;

      FOR block_idx IN 0 .. jsonb_array_length(blocks) - 1 LOOP
        block_obj := blocks -> block_idx;
        btype := block_obj ->> 'type';
        IF btype IN ('paragraph','quote','callout','heading','highlight') THEN
          txt := block_obj ->> 'text';
          IF txt IS NOT NULL AND txt ~ 'https?://' AND txt !~ '\]\(https?://' THEN
            new_txt := regexp_replace(txt, url_re, '[\1](\1)', 'g');
            IF new_txt <> txt THEN
              new_pages := jsonb_set(
                new_pages,
                ARRAY[page_idx::text, 'blocks', block_idx::text, 'text'],
                to_jsonb(new_txt),
                false
              );
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;

    IF new_pages IS DISTINCT FROM rec.pages THEN
      UPDATE public.books SET pages = new_pages WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;