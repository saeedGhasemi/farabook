
CREATE OR REPLACE FUNCTION public.admin_get_fee_settings()
RETURNS public.platform_fee_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result public.platform_fee_settings;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT * INTO result FROM public.platform_fee_settings WHERE id = 1;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_fee_settings() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_get_fee_settings() TO authenticated;
