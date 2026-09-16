-- Fix signup: "Database error saving new user" (auth trigger → profiles)
-- Harden handle_new_user + grant to auth admin; app_settings for WhatsApp support number.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_phone text;
  v_code text;
BEGIN
  v_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''), 'Player');
  v_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  v_code := upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.profiles (id, display_name, phone, coins, is_admin, referral_code)
  VALUES (NEW.id, v_name, v_phone, 1000, false, v_code)
  ON CONFLICT (id) DO UPDATE
    SET
      display_name = COALESCE(NULLIF(trim(profiles.display_name), ''), EXCLUDED.display_name),
      phone = COALESCE(NULLIF(trim(profiles.phone), ''), EXCLUDED.phone),
      referral_code = COALESCE(profiles.referral_code, EXCLUDED.referral_code);

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- referral_code collision — retry without unique code, then ensure later
    INSERT INTO public.profiles (id, display_name, phone, coins, is_admin)
    VALUES (NEW.id, v_name, v_phone, 1000, false)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed: %', SQLERRM;
    -- Still allow auth user creation; client can create profile on first login
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, anon, authenticated, service_role;
-- Auth service role (name varies); ignore if missing
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- Allow profile insert during signup edge cases (uid matches)
DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
CREATE POLICY "insert_own_profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- ── App settings (support WhatsApp) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_app_settings" ON public.app_settings;
CREATE POLICY "read_app_settings" ON public.app_settings
  FOR SELECT TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "admin_write_app_settings" ON public.app_settings;
CREATE POLICY "admin_write_app_settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.app_settings (key, value)
VALUES ('support_whatsapp', '919999999999')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_support_whatsapp()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(trim(value), '') FROM public.app_settings WHERE key = 'support_whatsapp'),
    '919999999999'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_support_whatsapp() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_support_whatsapp(p_number text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  v_digits := regexp_replace(COALESCE(p_number, ''), '[^0-9]', '', 'g');
  IF length(v_digits) < 10 OR length(v_digits) > 15 THEN
    RAISE EXCEPTION 'Enter a valid WhatsApp number with country code (10–15 digits)';
  END IF;
  INSERT INTO public.app_settings (key, value, updated_at, updated_by)
  VALUES ('support_whatsapp', v_digits, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now(),
        updated_by = auth.uid();
  RETURN v_digits;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_support_whatsapp(text) TO authenticated;
