
-- Allow self-service negative credit transactions (deductions like purchases)
DROP POLICY IF EXISTS credit_tx_insert_self_negative ON public.credit_transactions;
CREATE POLICY credit_tx_insert_self_negative
  ON public.credit_transactions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND amount < 0);

-- Atomic book purchase using credits (10× book price for testing)
CREATE OR REPLACE FUNCTION public.purchase_book(_book_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  book_price numeric;
  cost numeric;
  balance numeric;
  already boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT price INTO book_price FROM public.books WHERE id = _book_id;
  IF book_price IS NULL THEN
    RAISE EXCEPTION 'book_not_found';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.user_books WHERE user_id = uid AND book_id = _book_id)
    INTO already;
  IF already THEN
    RAISE EXCEPTION 'already_owned';
  END IF;

  cost := book_price * 10;  -- test multiplier

  SELECT COALESCE(SUM(amount), 0) INTO balance
    FROM public.credit_transactions WHERE user_id = uid;

  IF cost > 0 AND balance < cost THEN
    RAISE EXCEPTION 'insufficient_credits';
  END IF;

  IF cost > 0 THEN
    INSERT INTO public.credit_transactions (user_id, amount, reason, metadata)
    VALUES (uid, -cost, 'book_purchase', jsonb_build_object('book_id', _book_id));
  END IF;

  INSERT INTO public.user_books (user_id, book_id, acquired_via)
  VALUES (uid, _book_id, 'purchase');

  RETURN jsonb_build_object(
    'cost', cost,
    'previous_balance', balance,
    'new_balance', balance - cost,
    'price', book_price
  );
END;
$$;
