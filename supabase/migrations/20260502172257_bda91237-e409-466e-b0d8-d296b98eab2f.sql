-- Phone & SMS prefs on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_notify_purchase BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_credit BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_revenue BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_approvals BOOLEAN NOT NULL DEFAULT true;

-- Validate Iranian mobile format on save (098xxxxxxxxx / 09xxxxxxxxx / +989xxxxxxxxx)
CREATE OR REPLACE FUNCTION public.normalize_iran_mobile(_p TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE s TEXT;
BEGIN
  IF _p IS NULL OR length(trim(_p)) = 0 THEN RETURN NULL; END IF;
  s := regexp_replace(_p, '\D', '', 'g');
  IF s ~ '^0098' THEN s := substr(s, 3); END IF;
  IF s ~ '^98'   THEN s := '0' || substr(s, 3); END IF;
  IF s ~ '^9'    AND length(s) = 10 THEN s := '0' || s; END IF;
  IF s !~ '^09\d{9}$' THEN
    RAISE EXCEPTION 'invalid_mobile';
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_profile_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND length(trim(NEW.phone)) > 0 THEN
    NEW.phone := public.normalize_iran_mobile(NEW.phone);
  ELSE
    NEW.phone := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_normalize_phone ON public.profiles;
CREATE TRIGGER profiles_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_profile_phone();

-- SMS settings (singleton)
CREATE TABLE IF NOT EXISTS public.sms_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  sender TEXT,
  tpl_purchase TEXT NOT NULL DEFAULT 'فرابوک: خرید «{title}» با موفقیت انجام شد. {cost} اعتبار کسر شد. مانده: {balance}',
  tpl_credit   TEXT NOT NULL DEFAULT 'فرابوک: {amount} اعتبار به حساب شما اضافه شد. مانده: {balance}',
  tpl_revenue  TEXT NOT NULL DEFAULT 'فرابوک: {amount} اعتبار درآمد از فروش «{title}» (سهم {role}) به حساب شما اضافه شد.',
  tpl_approval TEXT NOT NULL DEFAULT 'فرابوک: {title} - {body}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

INSERT INTO public.sms_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sms_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_settings_select_admin ON public.sms_settings;
CREATE POLICY sms_settings_select_admin ON public.sms_settings
  FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS sms_settings_update_admin ON public.sms_settings;
CREATE POLICY sms_settings_update_admin ON public.sms_settings
  FOR UPDATE USING (public.is_admin(auth.uid()));

-- SMS log
CREATE TABLE IF NOT EXISTS public.sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  phone TEXT NOT NULL,
  event TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  provider_message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sms_log_select_admin ON public.sms_log;
CREATE POLICY sms_log_select_admin ON public.sms_log
  FOR SELECT USING (public.is_admin(auth.uid()) OR auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS sms_log_user_idx ON public.sms_log(user_id, created_at DESC);