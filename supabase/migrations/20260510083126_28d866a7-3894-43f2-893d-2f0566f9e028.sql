
-- Restore public select; pricing/fee values are needed by client UIs.
DROP POLICY IF EXISTS fees_select_admin ON public.platform_fee_settings;
CREATE POLICY fees_select_all ON public.platform_fee_settings
  FOR SELECT USING (true);

-- Hide internal USD cost columns from anon/authenticated; admins read via
-- the SECURITY DEFINER admin RPCs / service role.
REVOKE SELECT (ai_text_suggest_usd, ai_image_gen_usd)
  ON public.platform_fee_settings FROM anon, authenticated;
