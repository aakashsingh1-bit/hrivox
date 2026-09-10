-- Fix infinite recursion on profiles + harden admin checks
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "admin_update_profiles" ON profiles;

DROP POLICY IF EXISTS "update_games_admin" ON games;
CREATE POLICY "update_games_admin" ON games
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "select_own_bets" ON bets;
CREATE POLICY "select_own_bets" ON bets
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "update_bets_admin" ON bets;
CREATE POLICY "update_bets_admin" ON bets
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "insert_results_admin" ON results_history;
CREATE POLICY "insert_results_admin" ON results_history
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- Confirm emails + seed profiles
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN ('admin@hrivox.com', 'player@hrivox.com');

INSERT INTO profiles (id, display_name, phone, coins, is_admin)
VALUES
  ('3e63f392-fb6c-44af-9bb6-c2a0036bea99', 'HRIVOX Admin', '9000000001', 5000, true),
  ('f5f7f2b8-5d7c-4b89-9506-8d1e85266e1e', 'Demo Player', '9000000002', 1000, false)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  phone = EXCLUDED.phone,
  is_admin = EXCLUDED.is_admin,
  coins = GREATEST(profiles.coins, EXCLUDED.coins);

-- Ensure games column + seed if empty
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_result_at timestamptz;

INSERT INTO games (name, short_code, schedule_time, result, is_active, next_result_at)
SELECT * FROM (VALUES
  ('Shri Ganesh', 'SG', 'Hourly', '', true, now() + interval '1 hour'),
  ('Faridabad', 'FB', 'Hourly', '', true, now() + interval '1 hour'),
  ('Ghaziabad', 'GZ', 'Hourly', '', true, now() + interval '1 hour'),
  ('Gali', 'GL', 'Hourly', '', true, now() + interval '1 hour'),
  ('Desawar', 'DW', 'Hourly', '', true, now() + interval '1 hour')
) AS v(name, short_code, schedule_time, result, is_active, next_result_at)
WHERE NOT EXISTS (SELECT 1 FROM games LIMIT 1);

UPDATE games SET next_result_at = COALESCE(next_result_at, now() + interval '1 hour') WHERE next_result_at IS NULL;
