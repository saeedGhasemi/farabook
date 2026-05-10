
-- 1) Restrict platform_fee_settings reads: hide internal cost columns from public
DROP POLICY IF EXISTS fees_select_all ON public.platform_fee_settings;
CREATE POLICY fees_select_admin ON public.platform_fee_settings
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- Provide a safe public view for callers that only need pricing facts
-- (credits-per-toman conversion + book purchase fee mode/value), without
-- leaking AI USD costs or signup/publish fees.
CREATE OR REPLACE FUNCTION public.get_public_fee_settings()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'credits_per_toman', credits_per_toman,
    'book_purchase_mode', book_purchase_mode,
    'book_purchase_value', book_purchase_value
  ) FROM public.platform_fee_settings WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.get_public_fee_settings() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_fee_settings() TO anon, authenticated;

-- 2) Remove self-insert of negative credit_transactions.
-- All credit deductions now flow through SECURITY DEFINER RPCs
-- (purchase_book, charge_ai_usage, request_publisher_upgrade_paid, etc.).
DROP POLICY IF EXISTS credit_tx_insert_self_negative ON public.credit_transactions;

-- 3) Tighten book-media write policies to the caller's own user-folder.
DROP POLICY IF EXISTS "book-media auth write" ON storage.objects;
CREATE POLICY "book-media auth write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "book-media auth update" ON storage.objects;
CREATE POLICY "book-media auth update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "book-media auth delete" ON storage.objects;
CREATE POLICY "book-media auth delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'book-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 4) Restrict public bucket listing on book-media (keep individual GETs working).
-- Public read of named objects is already provided by the existing
-- "Public read for book-media" policy; we don't need anonymous LIST access.
-- (No-op if no over-broad SELECT policy exists; the Supabase linter flags
-- the public bucket itself — see security memory.)
