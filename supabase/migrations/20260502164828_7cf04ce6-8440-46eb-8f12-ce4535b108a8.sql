
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_select_public_basic ON public.profiles;
CREATE POLICY profiles_select_public_basic
  ON public.profiles FOR SELECT
  USING (true);
