-- Add is_active flag to profiles for enable/disable user
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Allow super admin to update any profile (for activation/deactivation)
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin
  ON public.profiles
  FOR UPDATE
  USING (public.is_super_admin(auth.uid()));

-- Allow super admin to delete profiles (cascade-style cleanup of user data)
DROP POLICY IF EXISTS profiles_delete_admin ON public.profiles;
CREATE POLICY profiles_delete_admin
  ON public.profiles
  FOR DELETE
  USING (public.is_super_admin(auth.uid()));

-- Helper: super admin deletes a user's app data (profile, roles, library, comments, highlights, publisher profile)
-- Note: cannot delete from auth.users via SQL policies; this only purges public schema data.
CREATE OR REPLACE FUNCTION public.admin_purge_user(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  DELETE FROM public.book_comments WHERE user_id = _user_id;
  DELETE FROM public.highlights WHERE user_id = _user_id;
  DELETE FROM public.user_books WHERE user_id = _user_id;
  DELETE FROM public.book_editors WHERE editor_id = _user_id;
  DELETE FROM public.editor_access_requests WHERE publisher_id = _user_id OR editor_user_id = _user_id;
  DELETE FROM public.credit_transactions WHERE user_id = _user_id;
  DELETE FROM public.credit_purchase_requests WHERE user_id = _user_id;
  DELETE FROM public.publisher_upgrade_requests WHERE user_id = _user_id;
  DELETE FROM public.publisher_profiles WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purge_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_purge_user(uuid) TO authenticated;