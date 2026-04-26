-- Add national_id (Iranian 10-digit code) and username to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS username text;

-- Unique (case-insensitive) constraints, but allow NULLs
CREATE UNIQUE INDEX IF NOT EXISTS profiles_national_id_unique
  ON public.profiles (national_id)
  WHERE national_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Iranian national-code validator (length 10, digits only, checksum)
CREATE OR REPLACE FUNCTION public.is_valid_iran_national_id(_code text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
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
  -- Reject sequences like 0000000000
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
$$;

-- Trigger to validate national_id on profile insert/update
CREATE OR REPLACE FUNCTION public.validate_profile_national_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.national_id IS NOT NULL AND NEW.national_id <> '' THEN
    NEW.national_id := regexp_replace(NEW.national_id, '\D', '', 'g');
    IF NOT public.is_valid_iran_national_id(NEW.national_id) THEN
      RAISE EXCEPTION 'invalid_national_id';
    END IF;
  ELSE
    NEW.national_id := NULL;
  END IF;
  IF NEW.username IS NOT NULL THEN
    NEW.username := nullif(trim(NEW.username), '');
    IF NEW.username IS NOT NULL AND NEW.username !~ '^[A-Za-z0-9_.\-]{3,32}$' THEN
      RAISE EXCEPTION 'invalid_username';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_profile_national_id ON public.profiles;
CREATE TRIGGER trg_validate_profile_national_id
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_national_id();

-- Allow super admin to view auth emails through a view? Instead: expose via secure RPC
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  username text,
  national_id text,
  is_active boolean,
  credits numeric,
  created_at timestamptz,
  roles text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT
    p.id,
    u.email::text,
    p.display_name,
    p.username,
    p.national_id,
    p.is_active,
    COALESCE(ct.total, 0) AS credits,
    p.created_at,
    COALESCE(r.roles, ARRAY[]::text[]) AS roles
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS total FROM public.credit_transactions WHERE user_id = p.id
  ) ct ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(role::text ORDER BY role::text) AS roles FROM public.user_roles WHERE user_id = p.id
  ) r ON true
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- Allow super admin to inline-update profile fields (display_name, username, national_id, is_active, contact_email, contact_phone)
-- Already covered by profiles_update_admin policy. Good.

-- Helper: super admin grants/revokes any role
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role app_role, _grant boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _grant THEN
    INSERT INTO public.user_roles (user_id, role, granted_by)
    VALUES (_user_id, _role, auth.uid())
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, app_role, boolean) TO authenticated;

-- Helper: admin adjusts credits with reason
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_user_id uuid, _amount numeric, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.credit_transactions (user_id, amount, reason, created_by)
  VALUES (_user_id, _amount, COALESCE(_reason, 'admin_adjust'), auth.uid());
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, numeric, text) TO authenticated;