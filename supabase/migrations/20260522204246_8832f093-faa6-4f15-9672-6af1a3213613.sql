DROP INDEX IF EXISTS public.user_offline_devices_user_book_device_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS user_offline_devices_user_book_device_uidx
ON public.user_offline_devices (user_id, book_id, device_id);