
-- 1. Add credits_per_toman column to platform_fee_settings
ALTER TABLE public.platform_fee_settings
  ADD COLUMN IF NOT EXISTS credits_per_toman numeric NOT NULL DEFAULT 10;

-- 2. payment_orders table
CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  gateway text NOT NULL DEFAULT 'zarinpal',
  amount_toman numeric NOT NULL CHECK (amount_toman > 0),
  credits numeric NOT NULL CHECK (credits > 0),
  authority text,
  ref_id text,
  status text NOT NULL DEFAULT 'pending', -- pending | paid | failed | canceled
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON public.payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_authority ON public.payment_orders(authority);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_select_own_or_admin ON public.payment_orders
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY po_insert_own ON public.payment_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- updates only via SECURITY DEFINER function

CREATE TRIGGER trg_payment_orders_updated
BEFORE UPDATE ON public.payment_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. RPC: complete_payment_order — credits user idempotently
CREATE OR REPLACE FUNCTION public.complete_payment_order(_order_id uuid, _ref_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ord public.payment_orders%ROWTYPE;
  new_balance numeric;
BEGIN
  SELECT * INTO ord FROM public.payment_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;

  IF ord.status = 'paid' THEN
    SELECT COALESCE(SUM(amount),0) INTO new_balance FROM public.credit_transactions WHERE user_id = ord.user_id;
    RETURN jsonb_build_object('already_paid', true, 'credits', ord.credits, 'new_balance', new_balance);
  END IF;

  UPDATE public.payment_orders
    SET status = 'paid', ref_id = _ref_id, updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
  VALUES (ord.user_id, ord.credits, 'bank_topup',
          jsonb_build_object(
            'order_id', ord.id,
            'gateway', ord.gateway,
            'amount_toman', ord.amount_toman,
            'ref_id', _ref_id,
            'authority', ord.authority
          ));

  SELECT COALESCE(SUM(amount),0) INTO new_balance FROM public.credit_transactions WHERE user_id = ord.user_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
  VALUES (ord.user_id, 'credit_topup',
          'افزایش اعتبار از درگاه بانکی',
          'مبلغ ' || ord.amount_toman::text || ' تومان واریز شد و ' || ord.credits::text || ' اعتبار به حساب شما اضافه شد.',
          '/credits',
          jsonb_build_object('order_id', ord.id, 'ref_id', _ref_id));

  RETURN jsonb_build_object('credits', ord.credits, 'new_balance', new_balance, 'ref_id', _ref_id);
END;
$$;

-- 4. RPC: mark order failed/canceled
CREATE OR REPLACE FUNCTION public.fail_payment_order(_order_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payment_orders
    SET status = CASE WHEN status = 'paid' THEN status ELSE 'failed' END,
        metadata = metadata || jsonb_build_object('fail_reason', _reason),
        updated_at = now()
    WHERE id = _order_id;
END;
$$;

-- 5. Update admin_update_platform_fees to accept credits_per_toman
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
    credits_per_toman = COALESCE((_settings->>'credits_per_toman')::numeric, credits_per_toman),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO result;
  RETURN result;
END;
$function$;
