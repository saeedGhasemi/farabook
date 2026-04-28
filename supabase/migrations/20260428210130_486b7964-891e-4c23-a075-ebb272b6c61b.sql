
-- 1) Extend platform_fee_settings
ALTER TABLE public.platform_fee_settings
  ADD COLUMN IF NOT EXISTS ai_text_suggest_cost numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS ai_image_gen_cost numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ai_text_suggest_usd numeric NOT NULL DEFAULT 0.002,
  ADD COLUMN IF NOT EXISTS ai_image_gen_usd numeric NOT NULL DEFAULT 0.04;

-- 2) ai_usage_log table
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  book_id uuid,
  operation text NOT NULL,                -- 'text_suggest' | 'image_gen' | other
  credits_charged numeric NOT NULL DEFAULT 0,
  usd_cost numeric NOT NULL DEFAULT 0,
  model text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_book ON public.ai_usage_log (book_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON public.ai_usage_log (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_op ON public.ai_usage_log (operation);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_select_admin ON public.ai_usage_log;
CREATE POLICY ai_usage_select_admin ON public.ai_usage_log
  FOR SELECT USING (public.is_admin(auth.uid()));

-- inserts only via service role (no policy needed); add explicit deny via no policy

-- 3) Update fees function to include AI fields
CREATE OR REPLACE FUNCTION public.admin_update_platform_fees(_settings jsonb)
 RETURNS platform_fee_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result public.platform_fee_settings;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.platform_fee_settings SET
    book_purchase_mode = COALESCE(_settings->>'book_purchase_mode', book_purchase_mode),
    book_purchase_value = COALESCE((_settings->>'book_purchase_value')::numeric, book_purchase_value),
    editor_order_mode = COALESCE(_settings->>'editor_order_mode', editor_order_mode),
    editor_order_value = COALESCE((_settings->>'editor_order_value')::numeric, editor_order_value),
    publisher_signup_mode = COALESCE(_settings->>'publisher_signup_mode', publisher_signup_mode),
    publisher_signup_value = COALESCE((_settings->>'publisher_signup_value')::numeric, publisher_signup_value),
    book_publish_mode = COALESCE(_settings->>'book_publish_mode', book_publish_mode),
    book_publish_value = COALESCE((_settings->>'book_publish_value')::numeric, book_publish_value),
    ai_text_suggest_cost = COALESCE((_settings->>'ai_text_suggest_cost')::numeric, ai_text_suggest_cost),
    ai_image_gen_cost = COALESCE((_settings->>'ai_image_gen_cost')::numeric, ai_image_gen_cost),
    ai_text_suggest_usd = COALESCE((_settings->>'ai_text_suggest_usd')::numeric, ai_text_suggest_usd),
    ai_image_gen_usd = COALESCE((_settings->>'ai_image_gen_usd')::numeric, ai_image_gen_usd),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO result;
  RETURN result;
END;
$function$;

-- 4) Admin function to list recent AI usage with book titles
CREATE OR REPLACE FUNCTION public.admin_recent_ai_usage(_limit integer DEFAULT 200)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  user_id uuid,
  user_name text,
  book_id uuid,
  book_title text,
  operation text,
  credits_charged numeric,
  usd_cost numeric,
  model text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT
    a.id, a.created_at, a.user_id,
    COALESCE(p.display_name, p.username, substring(a.user_id::text, 1, 8)) AS user_name,
    a.book_id, b.title AS book_title,
    a.operation, a.credits_charged, a.usd_cost, a.model, a.metadata
  FROM public.ai_usage_log a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  LEFT JOIN public.books b ON b.id = a.book_id
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(1000, _limit));
END;
$$;

-- 5) Function for users to charge themselves AI credits server-side
-- (so credits flow through normal credit_transactions and admins can see it)
CREATE OR REPLACE FUNCTION public.charge_ai_usage(
  _operation text,
  _book_id uuid,
  _model text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  fees public.platform_fee_settings%ROWTYPE;
  cost numeric := 0;
  usd numeric := 0;
  balance numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO fees FROM public.platform_fee_settings WHERE id = 1;
  IF _operation = 'text_suggest' THEN
    cost := COALESCE(fees.ai_text_suggest_cost, 0);
    usd := COALESCE(fees.ai_text_suggest_usd, 0);
  ELSIF _operation = 'image_gen' THEN
    cost := COALESCE(fees.ai_image_gen_cost, 0);
    usd := COALESCE(fees.ai_image_gen_usd, 0);
  ELSE
    RAISE EXCEPTION 'unknown_operation';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO balance FROM public.credit_transactions WHERE user_id = uid;
  IF cost > 0 AND balance < cost THEN RAISE EXCEPTION 'insufficient_credits'; END IF;

  IF cost > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
    VALUES (uid, -cost, 'ai_' || _operation,
            jsonb_build_object('book_id', _book_id, 'model', _model) || COALESCE(_metadata, '{}'::jsonb));
  END IF;

  INSERT INTO public.ai_usage_log (user_id, book_id, operation, credits_charged, usd_cost, model, metadata)
  VALUES (uid, _book_id, _operation, cost, usd, _model, COALESCE(_metadata, '{}'::jsonb));

  RETURN jsonb_build_object('cost', cost, 'usd', usd, 'new_balance', balance - cost);
END;
$$;
