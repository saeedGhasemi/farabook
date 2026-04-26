-- =========================================================
-- 1. editor_access_requests table
-- =========================================================
CREATE TABLE IF NOT EXISTS public.editor_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  publisher_id uuid NOT NULL,
  editor_email text NOT NULL,
  editor_user_id uuid,
  message text,
  can_publish boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ear_book ON public.editor_access_requests(book_id);
CREATE INDEX IF NOT EXISTS idx_ear_email ON public.editor_access_requests(lower(editor_email));
CREATE INDEX IF NOT EXISTS idx_ear_editor_user ON public.editor_access_requests(editor_user_id);
CREATE INDEX IF NOT EXISTS idx_ear_status ON public.editor_access_requests(status);

ALTER TABLE public.editor_access_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_ear_touch ON public.editor_access_requests;
CREATE TRIGGER trg_ear_touch
BEFORE UPDATE ON public.editor_access_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- 2. find_user_by_email helper (restricted)
-- =========================================================
CREATE OR REPLACE FUNCTION public.find_user_by_email(_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  -- Only allow admins or publishers to look up; prevents enumeration by random users.
  IF NOT (public.is_admin(auth.uid()) OR public.is_publisher(auth.uid())) THEN
    RETURN NULL;
  END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  RETURN uid;
END;
$$;

REVOKE ALL ON FUNCTION public.find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_by_email(text) TO authenticated;

-- =========================================================
-- 3. RLS policies for editor_access_requests
-- =========================================================
DROP POLICY IF EXISTS ear_select ON public.editor_access_requests;
CREATE POLICY ear_select ON public.editor_access_requests
FOR SELECT USING (
  auth.uid() = publisher_id
  OR auth.uid() = editor_user_id
  OR public.is_admin(auth.uid())
  OR (
    -- recipient looking up by their own email
    editor_user_id IS NULL
    AND lower(editor_email) = lower(coalesce((SELECT email FROM auth.users WHERE id = auth.uid()), ''))
  )
);

DROP POLICY IF EXISTS ear_insert ON public.editor_access_requests;
CREATE POLICY ear_insert ON public.editor_access_requests
FOR INSERT WITH CHECK (
  auth.uid() = publisher_id
  AND (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.publisher_id = auth.uid())
    OR public.is_admin(auth.uid())
  )
);

DROP POLICY IF EXISTS ear_update ON public.editor_access_requests;
CREATE POLICY ear_update ON public.editor_access_requests
FOR UPDATE USING (
  auth.uid() = publisher_id
  OR auth.uid() = editor_user_id
  OR public.is_admin(auth.uid())
  OR (
    editor_user_id IS NULL
    AND lower(editor_email) = lower(coalesce((SELECT email FROM auth.users WHERE id = auth.uid()), ''))
  )
);

DROP POLICY IF EXISTS ear_delete ON public.editor_access_requests;
CREATE POLICY ear_delete ON public.editor_access_requests
FOR DELETE USING (public.is_super_admin(auth.uid()));

-- =========================================================
-- 4. accept_editor_request RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.accept_editor_request(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.editor_access_requests%ROWTYPE;
  caller_email text;
BEGIN
  SELECT * INTO req FROM public.editor_access_requests WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF req.status <> 'pending' THEN RAISE EXCEPTION 'request_not_pending'; END IF;

  SELECT email INTO caller_email FROM auth.users WHERE id = auth.uid();

  IF NOT (
    auth.uid() = req.editor_user_id
    OR (req.editor_user_id IS NULL AND lower(caller_email) = lower(req.editor_email))
    OR public.is_admin(auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Ensure editor role
  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (auth.uid(), 'editor', req.publisher_id)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Grant book access
  INSERT INTO public.book_editors (book_id, editor_id, granted_by, can_publish)
  VALUES (req.book_id, auth.uid(), req.publisher_id, req.can_publish)
  ON CONFLICT DO NOTHING;

  UPDATE public.editor_access_requests
     SET status = 'accepted',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         editor_user_id = auth.uid()
   WHERE id = _request_id;

  RETURN req.book_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_editor_request(uuid) TO authenticated;

-- =========================================================
-- 5. Improved handle_new_user_role trigger (auto-seed)
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  extra_role text := meta->>'seed_role';
  is_publisher_seed boolean := COALESCE((meta->>'seed_publisher')::boolean, false);
  trusted boolean := COALESCE((meta->>'seed_trusted')::boolean, false);
  starter_credits numeric := COALESCE((meta->>'seed_credits')::numeric, 0);
  display text := COALESCE(meta->>'display_name', split_part(NEW.email, '@', 1));
  slug_val text;
BEGIN
  -- Default user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Super admin bootstrap
  IF NEW.email = 'mohammadi219@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'super_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Optional extra role from metadata
  IF extra_role IS NOT NULL AND extra_role IN ('super_admin','admin','moderator','reviewer','publisher','editor') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, extra_role::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  -- Auto-create publisher profile
  IF is_publisher_seed OR extra_role = 'publisher' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'publisher')
    ON CONFLICT (user_id, role) DO NOTHING;

    slug_val := regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9\-]', '-', 'g');
    INSERT INTO public.publisher_profiles (user_id, display_name, slug, bio, theme, is_trusted, is_active)
    VALUES (
      NEW.id,
      display,
      slug_val,
      COALESCE(meta->>'seed_bio', 'ناشر آزمایشی'),
      'paper',
      trusted,
      true
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- Starter credits (recorded as transaction)
  IF starter_credits > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason)
    VALUES (NEW.id, starter_credits, 'seed_starter_credits');
  END IF;

  RETURN NEW;
END;
$$;

-- Make sure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- 6. Idempotent re-seed for any existing test users (in case seeded earlier without trigger metadata)
-- =========================================================
DO $$
DECLARE
  rec record;
BEGIN
  -- Ensure super admin role for the bootstrap email if user already exists
  FOR rec IN SELECT id FROM auth.users WHERE email = 'mohammadi219@gmail.com' LOOP
    INSERT INTO public.user_roles (user_id, role) VALUES (rec.id, 'super_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;

  -- Standard test users
  FOR rec IN SELECT id, email FROM auth.users WHERE email IN ('user1@test.com','user2@test.com') LOOP
    INSERT INTO public.profiles (id, display_name)
    VALUES (rec.id, split_part(rec.email,'@',1))
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (rec.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;

  -- Publisher test user
  FOR rec IN SELECT id, email FROM auth.users WHERE email = 'publisher1@test.com' LOOP
    INSERT INTO public.profiles (id, display_name)
    VALUES (rec.id, 'ناشر تست')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (rec.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES (rec.id, 'publisher')
    ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.publisher_profiles (user_id, display_name, slug, bio, theme, is_trusted, is_active)
    VALUES (rec.id, 'ناشر تست', 'publisher1', 'ناشر آزمایشی برای دموی سامانه', 'paper', true, true)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END $$;