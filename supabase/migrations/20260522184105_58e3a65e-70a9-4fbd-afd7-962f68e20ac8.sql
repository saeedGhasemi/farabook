
-- Make offline device limit per-book instead of per-user.
-- Add book_id column (nullable so legacy global rows survive),
-- swap the unique constraint to (user_id, book_id, device_id).

ALTER TABLE public.user_offline_devices
  ADD COLUMN IF NOT EXISTS book_id uuid;

-- Drop the old per-user unique constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_offline_devices_user_id_device_id_key'
  ) THEN
    ALTER TABLE public.user_offline_devices
      DROP CONSTRAINT user_offline_devices_user_id_device_id_key;
  END IF;
END $$;

-- Per-book uniqueness: same device may register for many books, but only once per book.
CREATE UNIQUE INDEX IF NOT EXISTS user_offline_devices_user_book_device_key
  ON public.user_offline_devices (user_id, COALESCE(book_id, '00000000-0000-0000-0000-000000000000'::uuid), device_id);

CREATE INDEX IF NOT EXISTS idx_user_offline_devices_user_book
  ON public.user_offline_devices (user_id, book_id);
