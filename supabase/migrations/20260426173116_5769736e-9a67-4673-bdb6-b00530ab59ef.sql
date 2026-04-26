-- ============================================
-- ACL SYSTEM: roles, publishers, editors, credits, reviews
-- ============================================

-- 1. Role enum
CREATE TYPE public.app_role AS ENUM (
  'super_admin',
  'admin',
  'moderator',
  'reviewer',
  'publisher',
  'editor',
  'user'
);

-- 2. user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role security definer (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- helper: is super admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

-- helper: is admin or super
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin', 'admin')
  )
$$;

-- helper: is publisher (trusted or not)
CREATE OR REPLACE FUNCTION public.is_publisher(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'publisher'
  )
$$;

-- RLS: user_roles
CREATE POLICY "users_view_own_roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "super_admin_manage_roles_insert" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin_manage_roles_update" ON public.user_roles
  FOR UPDATE USING (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin_manage_roles_delete" ON public.user_roles
  FOR DELETE USING (public.is_super_admin(auth.uid()));

-- 4. publisher_profiles (storefront)
CREATE TABLE public.publisher_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  slug text UNIQUE NOT NULL,
  bio text,
  banner_url text,
  logo_url text,
  theme text DEFAULT 'paper',
  website text,
  is_trusted boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publisher_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publisher_profiles_select_all" ON public.publisher_profiles
  FOR SELECT USING (is_active = true OR auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "publisher_profiles_insert_own" ON public.publisher_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_publisher(auth.uid()));

CREATE POLICY "publisher_profiles_update_own_or_admin" ON public.publisher_profiles
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "publisher_profiles_delete_admin" ON public.publisher_profiles
  FOR DELETE USING (public.is_super_admin(auth.uid()));

-- 5. book_editors (per-book editor access)
CREATE TABLE public.book_editors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  editor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES auth.users(id),
  can_publish boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, editor_id)
);

ALTER TABLE public.book_editors ENABLE ROW LEVEL SECURITY;

-- helper: can edit book
CREATE OR REPLACE FUNCTION public.can_edit_book(_user_id uuid, _book_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.books WHERE id = _book_id AND publisher_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.book_editors WHERE book_id = _book_id AND editor_id = _user_id
  ) OR public.is_admin(_user_id)
$$;

CREATE POLICY "book_editors_select" ON public.book_editors
  FOR SELECT USING (
    auth.uid() = editor_id
    OR EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.publisher_id = auth.uid())
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "book_editors_insert_owner" ON public.book_editors
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.publisher_id = auth.uid())
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "book_editors_update_owner" ON public.book_editors
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.publisher_id = auth.uid())
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "book_editors_delete_owner" ON public.book_editors
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.books b WHERE b.id = book_id AND b.publisher_id = auth.uid())
    OR public.is_admin(auth.uid())
  );

-- 6. credit_transactions
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  reason text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_tx_select_own_or_admin" ON public.credit_transactions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "credit_tx_insert_admin" ON public.credit_transactions
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

-- 7. credit_purchase_requests (manual approval)
CREATE TABLE public.credit_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  payment_reference text,
  note text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_req_select_own_or_admin" ON public.credit_purchase_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "credit_req_insert_own" ON public.credit_purchase_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "credit_req_update_admin" ON public.credit_purchase_requests
  FOR UPDATE USING (public.is_admin(auth.uid()));

-- 8. publisher_upgrade_requests
CREATE TABLE public.publisher_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  bio text,
  website text,
  credits_offered numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.publisher_upgrade_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pub_req_select_own_or_admin" ON public.publisher_upgrade_requests
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

CREATE POLICY "pub_req_insert_own" ON public.publisher_upgrade_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pub_req_update_admin" ON public.publisher_upgrade_requests
  FOR UPDATE USING (public.is_admin(auth.uid()));

-- 9. book_reviews
CREATE TABLE public.book_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating int CHECK (rating BETWEEN 1 AND 5),
  title text,
  body text NOT NULL,
  is_official boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, reviewer_id)
);

ALTER TABLE public.book_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews_select_all" ON public.book_reviews
  FOR SELECT USING (true);

CREATE POLICY "reviews_insert_reviewer" ON public.book_reviews
  FOR INSERT WITH CHECK (
    auth.uid() = reviewer_id
    AND (NOT is_official OR public.has_role(auth.uid(), 'reviewer') OR public.is_admin(auth.uid()))
  );

CREATE POLICY "reviews_update_own" ON public.book_reviews
  FOR UPDATE USING (auth.uid() = reviewer_id OR public.is_admin(auth.uid()));

CREATE POLICY "reviews_delete_own_or_admin" ON public.book_reviews
  FOR DELETE USING (auth.uid() = reviewer_id OR public.is_admin(auth.uid()));

-- 10. Update books: add review fields
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- Replace books policies to integrate roles + editors
DROP POLICY IF EXISTS books_select_published_or_owner ON public.books;
DROP POLICY IF EXISTS books_insert_own ON public.books;
DROP POLICY IF EXISTS books_update_own ON public.books;
DROP POLICY IF EXISTS books_delete_own ON public.books;

CREATE POLICY "books_select" ON public.books
  FOR SELECT USING (
    (status = 'published' AND review_status = 'approved')
    OR auth.uid() = publisher_id
    OR public.can_edit_book(auth.uid(), id)
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'moderator')
  );

CREATE POLICY "books_insert_publisher" ON public.books
  FOR INSERT WITH CHECK (
    auth.uid() = publisher_id
    AND (public.is_publisher(auth.uid()) OR public.is_admin(auth.uid()))
  );

CREATE POLICY "books_update_owner_or_editor" ON public.books
  FOR UPDATE USING (
    auth.uid() = publisher_id
    OR public.can_edit_book(auth.uid(), id)
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'moderator')
  );

CREATE POLICY "books_delete_owner_or_admin" ON public.books
  FOR DELETE USING (
    auth.uid() = publisher_id OR public.is_admin(auth.uid())
  );

-- 11. Auto-grant 'user' role on signup; promote first user matching seed email to super_admin
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  IF NEW.email = 'mohammadi219@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'super_admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Backfill: ensure existing users have 'user' role and that target email is super_admin
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'user'::app_role FROM auth.users u
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'super_admin'::app_role
FROM auth.users u
WHERE u.email = 'mohammadi219@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 12. Triggers updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER pub_profiles_touch BEFORE UPDATE ON public.publisher_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 13. Indexes
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_book_editors_book ON public.book_editors(book_id);
CREATE INDEX IF NOT EXISTS idx_book_editors_editor ON public.book_editors(editor_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_req_status ON public.credit_purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_pub_req_status ON public.publisher_upgrade_requests(status);
CREATE INDEX IF NOT EXISTS idx_books_review_status ON public.books(review_status);