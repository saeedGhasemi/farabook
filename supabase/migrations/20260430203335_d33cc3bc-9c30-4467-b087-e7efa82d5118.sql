-- Books: enable/disable comments globally per book
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS comments_enabled boolean NOT NULL DEFAULT true;

-- Comments: per-comment hide flag
ALTER TABLE public.book_comments
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

-- Replace SELECT policy: hidden comments are visible only to owner of the comment,
-- the book publisher, admins and moderators.
DROP POLICY IF EXISTS bc_select_all ON public.book_comments;
CREATE POLICY bc_select_visible
ON public.book_comments
FOR SELECT
USING (
  is_hidden = false
  OR auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.books b
    WHERE b.id = book_comments.book_id AND b.publisher_id = auth.uid()
  )
);

-- Allow book publisher to update (hide/unhide) comments on their own books, in addition
-- to existing rule (own comment / admin / moderator).
DROP POLICY IF EXISTS bc_update_own_or_mod ON public.book_comments;
CREATE POLICY bc_update_own_mod_or_publisher
ON public.book_comments
FOR UPDATE
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.books b
    WHERE b.id = book_comments.book_id AND b.publisher_id = auth.uid()
  )
);

-- Allow publisher to delete comments on their books too
DROP POLICY IF EXISTS bc_delete_own_or_mod ON public.book_comments;
CREATE POLICY bc_delete_own_mod_or_publisher
ON public.book_comments
FOR DELETE
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'moderator'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.books b
    WHERE b.id = book_comments.book_id AND b.publisher_id = auth.uid()
  )
);