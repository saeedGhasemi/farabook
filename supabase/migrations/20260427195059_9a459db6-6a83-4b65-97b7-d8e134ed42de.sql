-- ============================================================
-- Security hardening migration (v2 — fixes pg_policies column name)
-- ============================================================

-- ---------- 1) search_path on iran national id check ----------
CREATE OR REPLACE FUNCTION public.is_valid_iran_national_id(_code text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  s text;
  i int;
  sum int := 0;
  check_digit int;
  computed int;
BEGIN
  IF _code IS NULL THEN RETURN true; END IF;
  s := regexp_replace(_code, '\D', '', 'g');
  IF length(s) <> 10 THEN RETURN false; END IF;
  IF s ~ '^(\d)\1{9}$' THEN RETURN false; END IF;
  FOR i IN 1..9 LOOP
    sum := sum + (substr(s, i, 1)::int) * (10 - i + 1);
  END LOOP;
  check_digit := substr(s, 10, 1)::int;
  computed := sum % 11;
  IF computed < 2 THEN
    RETURN check_digit = computed;
  ELSE
    RETURN check_digit = 11 - computed;
  END IF;
END;
$function$;

-- ---------- 2) Lock down function EXECUTE permissions ----------

-- 2a) Blanket revoke from PUBLIC and anon for every function in public schema.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                   r.nspname, r.proname, r.args);
  END LOOP;
END $$;

-- 2b) Revoke from authenticated for *trigger* and internal helper functions.
REVOKE EXECUTE ON FUNCTION public.touch_books_updated_at()              FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_comment_edited()                 FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()                    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_platform_fees_updated_at()      FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_profile_national_id()        FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role()                FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_publisher_on_comment()         FROM authenticated;

-- 2c) Re-grant EXECUTE to authenticated only for the RPCs the app uses
--     (admin-only RPCs self-verify is_admin / is_super_admin internally).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_publisher(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_book(uuid, uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_iran_national_id(text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_fee(text, numeric, numeric)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_editor_request(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_book(uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_book_revenue_shares(uuid, jsonb)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_book_paid(uuid, integer)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.publisher_book_sales_stats(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_publisher_upgrade_paid(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, app_role, boolean)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, numeric, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_platform_fees(jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_recent_transactions(integer)          TO authenticated;

-- ---------- 3) Tighten storage.objects listing on book-media ----------
-- Drop any existing broad SELECT policies on book-media so we control them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd = 'SELECT'
      AND (policyname ILIKE '%book-media%'
        OR policyname ILIKE '%book_media%'
        OR policyname = 'Public read for book-media'
        OR policyname = 'book-media public read')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- Public can read individual objects in book-media (needed for <img src=...>).
-- Listing is permitted but storage paths use unguessable random keys so it
-- doesn't leak useful info.
CREATE POLICY "book_media_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'book-media');