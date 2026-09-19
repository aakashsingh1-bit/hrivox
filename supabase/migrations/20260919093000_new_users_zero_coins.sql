-- New users start with 0 coins (no free starter balance).

ALTER TABLE public.profiles
  ALTER COLUMN coins SET DEFAULT 0;

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
  VALUES (NEW.id, v_name, v_phone, 0, false, v_code)
  ON CONFLICT (id) DO UPDATE
    SET
      display_name = COALESCE(NULLIF(trim(profiles.display_name), ''), EXCLUDED.display_name),
      phone = COALESCE(NULLIF(trim(profiles.phone), ''), EXCLUDED.phone),
      referral_code = COALESCE(profiles.referral_code, EXCLUDED.referral_code);

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    INSERT INTO public.profiles (id, display_name, phone, coins, is_admin)
    VALUES (NEW.id, v_name, v_phone, 0, false)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed: %', SQLERRM;
    RETURN NEW;
END;
$$;
