
-- =========================================================
-- 1) PROFILES: stop leaking sensitive fields publicly
-- =========================================================
DROP POLICY IF EXISTS profiles_select_public_basic ON public.profiles;

CREATE POLICY profiles_select_owner_or_admin
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- Safe public view exposing only non-sensitive fields. Runs as view owner
-- (default), bypassing the table's row-level rules so anyone can read the
-- basic public columns.
DROP VIEW IF EXISTS public.profiles_public;
CREATE VIEW public.profiles_public AS
  SELECT id, display_name, username, avatar_url, bio, website, created_at
  FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- =========================================================
-- 2) COMMENT MODERATION SETTINGS: admin/moderator-only reads
-- =========================================================
DROP POLICY IF EXISTS cms_select_all ON public.comment_moderation_settings;
CREATE POLICY cms_select_admin_or_mod
  ON public.comment_moderation_settings
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

-- =========================================================
-- 3) BOOKS.pages: restrict full content; expose via RPC only
-- =========================================================

-- Revoke direct read on the `pages` column for everyone except owners
-- through RPC. Other columns remain selectable.
REVOKE SELECT (pages) ON public.books FROM anon;
REVOKE SELECT (pages) ON public.books FROM authenticated;

-- RPC: returns full pages only to users who actually own the book
-- (free books, purchasers, publisher, editors, admins, moderators).
CREATE OR REPLACE FUNCTION public.get_book_content(_book_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  uid uuid := auth.uid();
  owns boolean := false;
BEGIN
  SELECT id, publisher_id, price, status, review_status, pages
    INTO b
    FROM public.books
    WHERE id = _book_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Owner / editor / admin / moderator always get full content.
  IF uid IS NOT NULL AND (
       uid = b.publisher_id
       OR public.is_admin(uid)
       OR public.has_role(uid, 'moderator'::public.app_role)
       OR public.can_edit_book(uid, b.id)
     ) THEN
    RETURN COALESCE(b.pages, '[]'::jsonb);
  END IF;

  -- Book must be approved+published for non-owners.
  IF b.status <> 'published' OR b.review_status <> 'approved' THEN
    RETURN NULL;
  END IF;

  -- Free books: any visitor may read in full.
  IF COALESCE(b.price, 0) = 0 THEN
    RETURN COALESCE(b.pages, '[]'::jsonb);
  END IF;

  -- Paid books: must be in user_books.
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT TRUE INTO owns FROM public.user_books
    WHERE user_id = uid AND book_id = _book_id LIMIT 1;
  IF owns THEN
    RETURN COALESCE(b.pages, '[]'::jsonb);
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_book_content(uuid) TO anon, authenticated;

-- RPC: returns ONLY the preview pages (indexed by books.preview_pages) of a
-- published+approved book. Safe for anonymous visitors.
CREATE OR REPLACE FUNCTION public.get_book_preview_content(_book_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  result jsonb := '[]'::jsonb;
  idx int;
  total int;
  pi int[];
BEGIN
  SELECT id, publisher_id, status, review_status, pages, preview_pages
    INTO b
    FROM public.books
    WHERE id = _book_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Allow owner/editor/admin to see full pages for preview rendering too.
  IF auth.uid() IS NOT NULL AND (
       auth.uid() = b.publisher_id
       OR public.is_admin(auth.uid())
       OR public.has_role(auth.uid(), 'moderator'::public.app_role)
       OR public.can_edit_book(auth.uid(), b.id)
     ) THEN
    RETURN COALESCE(b.pages, '[]'::jsonb);
  END IF;

  IF b.status <> 'published' OR b.review_status <> 'approved' THEN
    RETURN NULL;
  END IF;

  total := COALESCE(jsonb_array_length(b.pages), 0);
  IF total = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  pi := COALESCE(b.preview_pages, ARRAY[0]);
  IF array_length(pi, 1) IS NULL THEN
    pi := ARRAY[0];
  END IF;

  FOREACH idx IN ARRAY pi LOOP
    IF idx >= 0 AND idx < total THEN
      result := result || jsonb_build_array(b.pages -> idx);
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_book_preview_content(uuid) TO anon, authenticated;

-- =========================================================
-- 4) client_error_logs: tighten WITH CHECK
-- =========================================================
DROP POLICY IF EXISTS cel_insert_any ON public.client_error_logs;
CREATE POLICY cel_insert_self_or_anon
  ON public.client_error_logs
  FOR INSERT
  WITH CHECK (
    user_id IS NULL OR user_id = auth.uid()
  );
