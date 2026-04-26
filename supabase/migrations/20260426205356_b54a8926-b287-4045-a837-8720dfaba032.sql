-- ============================================================
-- 1. PLATFORM FEE SETTINGS (single row, admin-managed)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_fee_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  -- Book purchase commission (default 10%)
  book_purchase_mode TEXT NOT NULL DEFAULT 'percent' CHECK (book_purchase_mode IN ('percent','fixed')),
  book_purchase_value NUMERIC NOT NULL DEFAULT 10,
  -- Editor order commission (default 10%)
  editor_order_mode TEXT NOT NULL DEFAULT 'percent' CHECK (editor_order_mode IN ('percent','fixed')),
  editor_order_value NUMERIC NOT NULL DEFAULT 10,
  -- Publisher signup fee (default 200 fixed credits)
  publisher_signup_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (publisher_signup_mode IN ('percent','fixed')),
  publisher_signup_value NUMERIC NOT NULL DEFAULT 200,
  -- Book initial publish fee (base × complexity factor 1-10)
  book_publish_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (book_publish_mode IN ('percent','fixed')),
  book_publish_value NUMERIC NOT NULL DEFAULT 50, -- base credits, multiplied by 1..10 complexity
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO public.platform_fee_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

ALTER TABLE public.platform_fee_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fees_select_all" ON public.platform_fee_settings
  FOR SELECT USING (true);
CREATE POLICY "fees_update_admin" ON public.platform_fee_settings
  FOR UPDATE USING (public.is_admin(auth.uid()));

-- ============================================================
-- 2. BOOK REVENUE SHARES (per-book beneficiary splits)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.book_revenue_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('author','editor','publisher')),
  percent NUMERIC NOT NULL CHECK (percent >= 0 AND percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_brs_book ON public.book_revenue_shares(book_id);
CREATE INDEX IF NOT EXISTS idx_brs_user ON public.book_revenue_shares(user_id);

ALTER TABLE public.book_revenue_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brs_select_all" ON public.book_revenue_shares
  FOR SELECT USING (true);
CREATE POLICY "brs_modify_owner_or_admin" ON public.book_revenue_shares
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.publisher_id = auth.uid() OR public.is_admin(auth.uid())))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND (b.publisher_id = auth.uid() OR public.is_admin(auth.uid())))
  );

-- ============================================================
-- 3. NOTIFICATIONS (in-app)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL,            -- e.g. 'revenue_received', 'purchase_success', 'fee_charged'
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  link TEXT,                     -- optional in-app link e.g. '/profile?tab=earnings'
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON public.notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
CREATE POLICY "notif_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notif_delete_own" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);
-- inserts only via security-definer functions; no public insert policy

-- ============================================================
-- 4. EXTEND BOOKS
-- ============================================================
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS author_user_id UUID,
  ADD COLUMN IF NOT EXISTS publish_complexity_factor INTEGER DEFAULT 1 CHECK (publish_complexity_factor BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS first_published_paid BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_books_author_user ON public.books(author_user_id);

-- ============================================================
-- 5. HELPER: settle a fee → returns amount transferred to platform
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_fee(_mode TEXT, _value NUMERIC, _base NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _mode = 'percent' THEN ROUND(_base * _value / 100)
    WHEN _mode = 'fixed' THEN _value
    ELSE 0
  END
$$;

-- ============================================================
-- 6. REWRITE purchase_book → splits revenue to beneficiaries
-- ============================================================
CREATE OR REPLACE FUNCTION public.purchase_book(_book_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  book_price NUMERIC;
  book_publisher UUID;
  book_title TEXT;
  cost NUMERIC;
  balance NUMERIC;
  already BOOLEAN;
  fees public.platform_fee_settings%ROWTYPE;
  platform_fee NUMERIC := 0;
  net_amount NUMERIC := 0;
  total_share_percent NUMERIC := 0;
  share RECORD;
  share_amount NUMERIC;
  publisher_remainder NUMERIC;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT price, publisher_id, title INTO book_price, book_publisher, book_title
    FROM public.books WHERE id = _book_id;
  IF book_price IS NULL THEN RAISE EXCEPTION 'book_not_found'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.user_books WHERE user_id = uid AND book_id = _book_id) INTO already;
  IF already THEN RAISE EXCEPTION 'already_owned'; END IF;

  cost := book_price * 10;  -- credit multiplier (test)

  SELECT COALESCE(SUM(amount),0) INTO balance FROM public.credit_transactions WHERE user_id = uid;
  IF cost > 0 AND balance < cost THEN RAISE EXCEPTION 'insufficient_credits'; END IF;

  -- Deduct full cost from buyer
  IF cost > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
    VALUES (uid, -cost, 'book_purchase', jsonb_build_object('book_id', _book_id));
  END IF;

  -- Add book to library
  INSERT INTO public.user_books (user_id, book_id, acquired_via)
  VALUES (uid, _book_id, 'purchase');

  -- Compute platform fee + net
  SELECT * INTO fees FROM public.platform_fee_settings WHERE id = 1;
  platform_fee := LEAST(cost, public.compute_fee(fees.book_purchase_mode, fees.book_purchase_value, cost));
  net_amount := cost - platform_fee;

  -- Distribute net: author + editor shares from book_revenue_shares; remainder → publisher
  IF net_amount > 0 AND book_publisher IS NOT NULL THEN
    -- Sum non-publisher shares
    SELECT COALESCE(SUM(percent),0) INTO total_share_percent
      FROM public.book_revenue_shares
      WHERE book_id = _book_id AND role IN ('author','editor');

    FOR share IN
      SELECT user_id, role, percent FROM public.book_revenue_shares
      WHERE book_id = _book_id AND role IN ('author','editor') AND percent > 0
    LOOP
      share_amount := ROUND(net_amount * share.percent / 100);
      IF share_amount > 0 THEN
        INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
        VALUES (share.user_id, share_amount, 'revenue_share_' || share.role,
                jsonb_build_object('book_id', _book_id, 'buyer_id', uid, 'percent', share.percent));
        INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
        VALUES (share.user_id, 'revenue_received',
                'درآمد جدید از فروش کتاب',
                'مبلغ ' || share_amount::TEXT || ' اعتبار بابت سهم ' || share.role || ' از فروش «' || book_title || '» به حساب شما اضافه شد.',
                '/profile?tab=earnings',
                jsonb_build_object('book_id', _book_id, 'amount', share_amount, 'role', share.role));
      END IF;
    END LOOP;

    -- Publisher gets the remainder
    publisher_remainder := net_amount - ROUND(net_amount * total_share_percent / 100);
    IF publisher_remainder > 0 THEN
      INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
      VALUES (book_publisher, publisher_remainder, 'revenue_share_publisher',
              jsonb_build_object('book_id', _book_id, 'buyer_id', uid));
      INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
      VALUES (book_publisher, 'revenue_received',
              'درآمد جدید از فروش کتاب',
              'مبلغ ' || publisher_remainder::TEXT || ' اعتبار بابت سهم ناشر از فروش «' || book_title || '» به حساب شما اضافه شد.',
              '/profile?tab=earnings',
              jsonb_build_object('book_id', _book_id, 'amount', publisher_remainder, 'role', 'publisher'));
    END IF;
  END IF;

  -- Notify buyer
  INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
  VALUES (uid, 'purchase_success',
          'خرید موفق',
          'کتاب «' || book_title || '» به قفسه شما اضافه شد. ' || cost::TEXT || ' اعتبار کسر شد.',
          '/library',
          jsonb_build_object('book_id', _book_id, 'cost', cost));

  RETURN jsonb_build_object(
    'cost', cost,
    'previous_balance', balance,
    'new_balance', balance - cost,
    'platform_fee', platform_fee,
    'net_distributed', net_amount,
    'price', book_price
  );
END;
$$;

-- ============================================================
-- 7. publish_book_paid → charges publisher on first publish
-- ============================================================
CREATE OR REPLACE FUNCTION public.publish_book_paid(_book_id UUID, _complexity INTEGER DEFAULT 1)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  book RECORD;
  fees public.platform_fee_settings%ROWTYPE;
  factor INTEGER;
  fee NUMERIC;
  balance NUMERIC;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO book FROM public.books WHERE id = _book_id;
  IF book IS NULL THEN RAISE EXCEPTION 'book_not_found'; END IF;
  IF book.publisher_id <> uid AND NOT public.is_admin(uid) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Skip if already paid
  IF book.first_published_paid THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_paid');
  END IF;

  factor := GREATEST(1, LEAST(10, COALESCE(_complexity, 1)));

  SELECT * INTO fees FROM public.platform_fee_settings WHERE id = 1;
  IF fees.book_publish_mode = 'percent' THEN
    fee := ROUND(book.price * 10 * fees.book_publish_value / 100) * factor;
  ELSE
    fee := fees.book_publish_value * factor;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO balance FROM public.credit_transactions WHERE user_id = uid;
  IF fee > 0 AND balance < fee THEN RAISE EXCEPTION 'insufficient_credits'; END IF;

  IF fee > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
    VALUES (uid, -fee, 'book_publish_fee',
            jsonb_build_object('book_id', _book_id, 'complexity', factor));
  END IF;

  UPDATE public.books
    SET first_published_paid = true, publish_complexity_factor = factor
    WHERE id = _book_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
  VALUES (uid, 'fee_charged', 'هزینه انتشار کسر شد',
          'بابت انتشار کتاب «' || book.title || '» مبلغ ' || fee::TEXT || ' اعتبار کسر شد.',
          '/publisher', jsonb_build_object('book_id', _book_id, 'fee', fee, 'complexity', factor));

  RETURN jsonb_build_object('fee', fee, 'complexity', factor, 'new_balance', balance - fee);
END;
$$;

-- ============================================================
-- 8. request_publisher_upgrade_paid
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_publisher_upgrade_paid(_display_name TEXT, _bio TEXT DEFAULT NULL, _website TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  fees public.platform_fee_settings%ROWTYPE;
  fee NUMERIC;
  balance NUMERIC;
  req_id UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.is_publisher(uid) THEN RAISE EXCEPTION 'already_publisher'; END IF;

  SELECT * INTO fees FROM public.platform_fee_settings WHERE id = 1;
  fee := COALESCE(fees.publisher_signup_value, 0);

  SELECT COALESCE(SUM(amount),0) INTO balance FROM public.credit_transactions WHERE user_id = uid;
  IF fee > 0 AND balance < fee THEN RAISE EXCEPTION 'insufficient_credits'; END IF;

  IF fee > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
    VALUES (uid, -fee, 'publisher_signup_fee', jsonb_build_object('display_name', _display_name));
  END IF;

  INSERT INTO public.publisher_upgrade_requests (user_id, display_name, bio, website, credits_offered)
  VALUES (uid, _display_name, _bio, _website, fee)
  RETURNING id INTO req_id;

  INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
  VALUES (uid, 'fee_charged', 'هزینه ناشر شدن کسر شد',
          'مبلغ ' || fee::TEXT || ' اعتبار بابت درخواست ناشر شدن کسر شد. درخواست شما در حال بررسی است.',
          '/profile?tab=earnings', jsonb_build_object('request_id', req_id, 'fee', fee));

  RETURN jsonb_build_object('request_id', req_id, 'fee', fee, 'new_balance', balance - fee);
END;
$$;

-- ============================================================
-- 9. admin_update_platform_fees
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_update_platform_fees(_settings JSONB)
RETURNS public.platform_fee_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    updated_at = now(), updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- ============================================================
-- 10. set_book_revenue_shares (publisher manages splits)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_book_revenue_shares(_book_id UUID, _shares JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  share JSONB;
  total NUMERIC := 0;
  fees public.platform_fee_settings%ROWTYPE;
  reserved_pct NUMERIC;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (EXISTS(SELECT 1 FROM public.books WHERE id = _book_id AND publisher_id = uid) OR public.is_admin(uid)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Validate total ≤ 100% minus platform percent (for percent mode)
  SELECT * INTO fees FROM public.platform_fee_settings WHERE id = 1;
  reserved_pct := CASE WHEN fees.book_purchase_mode = 'percent' THEN fees.book_purchase_value ELSE 0 END;

  FOR share IN SELECT * FROM jsonb_array_elements(_shares) LOOP
    total := total + (share->>'percent')::numeric;
  END LOOP;
  IF total + reserved_pct > 100 THEN
    RAISE EXCEPTION 'shares_exceed_100';
  END IF;

  -- Replace all shares for this book
  DELETE FROM public.book_revenue_shares WHERE book_id = _book_id;
  FOR share IN SELECT * FROM jsonb_array_elements(_shares) LOOP
    IF (share->>'user_id') IS NOT NULL AND (share->>'percent')::numeric > 0 THEN
      INSERT INTO public.book_revenue_shares (book_id, user_id, role, percent)
      VALUES (_book_id, (share->>'user_id')::uuid, share->>'role', (share->>'percent')::numeric)
      ON CONFLICT (book_id, user_id, role) DO UPDATE SET percent = EXCLUDED.percent;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('total_assigned', total, 'platform_reserved', reserved_pct);
END;
$$;

-- ============================================================
-- 11. Touch trigger for fees updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_platform_fees_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_platform_fees ON public.platform_fee_settings;
CREATE TRIGGER trg_touch_platform_fees
  BEFORE UPDATE ON public.platform_fee_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_platform_fees_updated_at();