-- Publisher sales stats: returns per-book sales count, gross revenue and recipient breakdown
-- Only the owning publisher (or admin) can read for their own books.
CREATE OR REPLACE FUNCTION public.publisher_book_sales_stats(_publisher_id uuid)
RETURNS TABLE (
  book_id uuid,
  sales_count integer,
  gross_credits numeric,
  to_publisher numeric,
  distribution jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (auth.uid() = _publisher_id OR public.is_admin(auth.uid())) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  WITH my_books AS (
    SELECT id FROM public.books WHERE publisher_id = _publisher_id
  ),
  purchases AS (
    SELECT (t.metadata->>'book_id')::uuid AS book_id,
           ABS(t.amount) AS amount
    FROM public.credit_transactions t
    WHERE t.reason = 'book_purchase'
      AND t.amount < 0
      AND (t.metadata->>'book_id')::uuid IN (SELECT id FROM my_books)
  ),
  shares AS (
    SELECT (t.metadata->>'book_id')::uuid AS book_id,
           t.user_id AS recipient_id,
           replace(t.reason, 'revenue_share_', '') AS role,
           t.amount AS amount,
           COALESCE(p.display_name, p.username, substring(t.user_id::text, 1, 8)) AS recipient_name
    FROM public.credit_transactions t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    WHERE t.reason LIKE 'revenue_share_%'
      AND t.amount > 0
      AND (t.metadata->>'book_id')::uuid IN (SELECT id FROM my_books)
  )
  SELECT
    b.id AS book_id,
    COALESCE((SELECT COUNT(*)::integer FROM purchases p WHERE p.book_id = b.id), 0) AS sales_count,
    COALESCE((SELECT SUM(amount) FROM purchases p WHERE p.book_id = b.id), 0) AS gross_credits,
    COALESCE((SELECT SUM(amount) FROM shares s WHERE s.book_id = b.id AND s.recipient_id = _publisher_id), 0) AS to_publisher,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'recipient_id', s.recipient_id,
        'recipient_name', s.recipient_name,
        'role', s.role,
        'amount', s.amount
      ))
      FROM shares s WHERE s.book_id = b.id
    ), '[]'::jsonb) AS distribution
  FROM my_books b;
END;
$$;

-- Admin-friendly transaction feed enriched with book + buyer + recipient names.
CREATE OR REPLACE FUNCTION public.admin_recent_transactions(_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  reason text,
  amount numeric,
  user_id uuid,
  user_name text,
  user_email text,
  book_id uuid,
  book_title text,
  buyer_id uuid,
  buyer_name text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT
    t.id,
    t.created_at,
    t.reason,
    t.amount,
    t.user_id,
    COALESCE(p.display_name, p.username, substring(t.user_id::text, 1, 8)) AS user_name,
    u.email::text AS user_email,
    NULLIF(t.metadata->>'book_id','')::uuid AS book_id,
    b.title AS book_title,
    NULLIF(t.metadata->>'buyer_id','')::uuid AS buyer_id,
    COALESCE(bp.display_name, bp.username) AS buyer_name,
    t.metadata
  FROM public.credit_transactions t
  LEFT JOIN public.profiles p ON p.id = t.user_id
  LEFT JOIN auth.users u ON u.id = t.user_id
  LEFT JOIN public.books b ON b.id = NULLIF(t.metadata->>'book_id','')::uuid
  LEFT JOIN public.profiles bp ON bp.id = NULLIF(t.metadata->>'buyer_id','')::uuid
  ORDER BY t.created_at DESC
  LIMIT GREATEST(1, LEAST(500, _limit));
END;
$$;