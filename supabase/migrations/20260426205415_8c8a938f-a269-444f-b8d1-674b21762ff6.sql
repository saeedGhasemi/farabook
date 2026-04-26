ALTER FUNCTION public.compute_fee(TEXT, NUMERIC, NUMERIC) SET search_path = public;
ALTER FUNCTION public.touch_platform_fees_updated_at() SET search_path = public;