WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, book_id, device_id
           ORDER BY last_seen_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM public.user_offline_devices
  WHERE book_id IS NOT NULL
)
DELETE FROM public.user_offline_devices d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS user_offline_devices_user_book_device_uidx
ON public.user_offline_devices (user_id, book_id, device_id)
WHERE book_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_offline_devices_user_device_seen_idx
ON public.user_offline_devices (user_id, device_id, last_seen_at DESC);