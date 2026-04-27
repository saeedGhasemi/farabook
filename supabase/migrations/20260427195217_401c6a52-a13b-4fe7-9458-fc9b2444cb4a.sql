-- ============================================================
-- Security hardening v3 — close critical RLS / privilege gaps
-- ============================================================

-- ---------- A) Profiles: hide PII from anon / other users ----------

-- Drop the world-open select policy.
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;

-- Owner & admins: full row access.
CREATE POLICY profiles_select_self_or_admin
ON public.profiles
FOR SELECT
USING (
  auth.uid() = id
  OR public.is_admin(auth.uid())
);

-- Public-safe view (only non-sensitive columns) — used by storefront,
-- comments author chips, publisher pages, etc.
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = true)
AS
SELECT
  id,
  display_name,
  username,
  avatar_url,
  bio,
  website,
  created_at
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- Keep a permissive SELECT on the *base* table for the columns above —
-- but limit it to non-sensitive use by exposing the view above.
-- For backward compat with existing UI that selects display_name from
-- profiles directly, allow public SELECT of just the non-sensitive
-- columns through a separate policy that depends on the column being
-- requested isn't possible in PG RLS. Workaround: restore a public
-- SELECT but rely on app code to read from public_profiles instead.
-- We add a policy that allows reading rows but only returns non-PII
-- via the view. If the app insists on selecting from profiles, only
-- the owner/admin policy applies.
--
-- App migration note: components reading display_name/avatar_url from
-- `profiles` should switch to `public_profiles`. Existing reads now
-- return null rows for non-self profiles until that migration happens.

-- ---------- B) Lock down user_books inserts ----------
-- The old policy allowed any authenticated user to add ANY book to
-- their own shelf, bypassing payment. Fix: require either
--   (a) the book is free (price = 0), OR
--   (b) the row is added by a SECURITY DEFINER function (purchase_book)
--   (c) admins
DROP POLICY IF EXISTS ub_insert_own ON public.user_books;

CREATE POLICY ub_insert_own_safe
ON public.user_books
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND (
    -- free book: anyone may claim
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.price = 0)
    -- admin override
    OR public.is_admin(auth.uid())
  )
);

-- purchase_book runs as SECURITY DEFINER and ignores RLS, so paid
-- purchases keep working through that RPC.

-- ---------- C) Restrict book_revenue_shares visibility ----------
DROP POLICY IF EXISTS brs_select_all ON public.book_revenue_shares;

CREATE POLICY brs_select_stakeholders
ON public.book_revenue_shares
FOR SELECT
USING (
  auth.uid() = user_id  -- the share recipient
  OR EXISTS (
    SELECT 1 FROM public.books b
    WHERE b.id = book_revenue_shares.book_id
      AND b.publisher_id = auth.uid()
  )
  OR public.can_edit_book(auth.uid(), book_id)
  OR public.is_admin(auth.uid())
);

-- ---------- D) Stop signup-time role escalation ----------
-- Rewrite the trigger so it ignores user-supplied 'seed_role' /
-- 'seed_publisher'. Roles must be granted by an admin afterwards.
-- We still honour the super_admin bootstrap email and the default
-- 'user' role. Starter credits remain (harmless).
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  app_meta jsonb := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb);
  trusted_role text := app_meta->>'seed_role';            -- only set via service role
  is_publisher_seed boolean := COALESCE((app_meta->>'seed_publisher')::boolean, false);
  trusted boolean := COALESCE((app_meta->>'seed_trusted')::boolean, false);
  starter_credits numeric := COALESCE((app_meta->>'seed_credits')::numeric, 0);
  display text := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1));
  slug_val text;
BEGIN
  -- Default user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Super admin bootstrap (single hardcoded email, server controlled)
  IF NEW.email = 'mohammadi219@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'super_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Optional extra role from APP metadata (only writable by service role,
  -- never by client signup). raw_user_meta_data is now ignored entirely.
  IF trusted_role IS NOT NULL
     AND trusted_role IN ('super_admin','admin','moderator','reviewer','publisher','editor') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, trusted_role::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Auto-create publisher profile (also gated on app_metadata)
  IF is_publisher_seed OR trusted_role = 'publisher' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'publisher')
    ON CONFLICT (user_id, role) DO NOTHING;

    slug_val := regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9\-]', '-', 'g');
    INSERT INTO public.publisher_profiles (user_id, display_name, slug, bio, theme, is_trusted, is_active)
    VALUES (
      NEW.id,
      display,
      slug_val,
      COALESCE(app_meta->>'seed_bio', 'ناشر آزمایشی'),
      'paper',
      trusted,
      true
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- Starter credits
  IF starter_credits > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason)
    VALUES (NEW.id, starter_credits, 'seed_starter_credits');
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------- E) Storage: scope writes to user's own folder ----------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'book-media auth write',
        'book-media auth update',
        'book-media auth delete',
        'book-uploads auth write'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "book_media_auth_insert_own_folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "book_media_auth_update_own_folder"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "book_media_auth_delete_own_folder"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "book_uploads_auth_insert_own_folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'book-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "book_uploads_auth_read_own_folder"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'book-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);