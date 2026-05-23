
-- Remove the prior view-based approach.
DROP VIEW IF EXISTS public.profiles_public;

-- Restore a permissive row-level read; column-level grants below restrict
-- which columns each role may actually read.
DROP POLICY IF EXISTS profiles_select_owner_or_admin ON public.profiles;
CREATE POLICY profiles_select_public_basic
  ON public.profiles
  FOR SELECT
  USING (true);

-- Block sensitive columns from being selected by clients.
REVOKE SELECT (national_id, phone, phone_verified, contact_email, contact_phone,
               credits, is_active,
               sms_notify_purchase, sms_notify_credit, sms_notify_revenue, sms_notify_approvals)
  ON public.profiles FROM anon, authenticated;

-- RPC for the signed-in user to fetch their own full profile.
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- RPC for super-admins to fetch any user's full profile.
CREATE OR REPLACE FUNCTION public.admin_get_profile(_user_id uuid)
RETURNS public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.profiles;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO r FROM public.profiles WHERE id = _user_id;
  RETURN r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_get_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_profile(uuid) TO authenticated;
