-- Claim orphaned legacy books to the active user so they can be edited / deleted.
UPDATE public.books
SET publisher_id = '68d44208-0470-4659-8975-f2754daebe08'
WHERE publisher_id IS NULL;