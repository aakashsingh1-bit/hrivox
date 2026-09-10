-- HRIVOX 900 full DB setup — paste ALL into Supabase SQL Editor and click Run
-- Project: tozwwujsxrerrahbywta

/*
# Game Platform Schema — Profiles, Games, Bets, Results

1. New Tables
- `profiles`: extends auth.users with display_name, phone, coins balance, is_admin flag
- `games`: 5 game entries with name, short_code, schedule time, current result, is_active
- `bets`: user bets on game numbers with amount, status (pending/won/lost)
- `results_history`: published results per game with timestamp

2. Security
- RLS enabled on all tables
- profiles: users read/update own profile; admin reads all
- games: all authenticated can read; only admin can update
- bets: users read/insert own bets; admin reads all
- results_history: all authenticated can read; admin inserts

3. Notes
- profiles.coins defaults to 100 demo coins on signup
- profiles.is_admin defaults to false
- games.is_active controls whether a game accepts bets (ON/OFF)
- bets.status: 'pending' (default), 'won', 'lost'
- When admin publishes a result, a trigger credits coins to winning bets
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Player',
  phone text DEFAULT '',
  coins integer NOT NULL DEFAULT 100,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Games table
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  short_code text NOT NULL,
  schedule_time text NOT NULL,
  result text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  result_published_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_games" ON games;
CREATE POLICY "read_games" ON games FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "update_games_admin" ON games;
CREATE POLICY "update_games_admin" ON games FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Bets table
CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  selected_number integer NOT NULL CHECK (selected_number >= 0 AND selected_number <= 9),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost')),
  payout integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_bets" ON bets;
CREATE POLICY "select_own_bets" ON bets FOR SELECT
  TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

DROP POLICY IF EXISTS "insert_own_bets" ON bets;
CREATE POLICY "insert_own_bets" ON bets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_bets_admin" ON bets;
CREATE POLICY "update_bets_admin" ON bets FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Results history table
CREATE TABLE IF NOT EXISTS results_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  result text NOT NULL,
  published_at timestamptz DEFAULT now()
);

ALTER TABLE results_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_results" ON results_history;
CREATE POLICY "read_results" ON results_history FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_results_admin" ON results_history;
CREATE POLICY "insert_results_admin" ON results_history FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true));

-- Function to handle result publication: credit winning bets
CREATE OR REPLACE FUNCTION publish_game_result(p_game_id uuid, p_result text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  winning_number integer;
  bet_record RECORD;
BEGIN
  winning_number := CAST(p_result AS integer);

  -- Update game result
  UPDATE games SET result = p_result, result_published_at = now() WHERE id = p_game_id;

  -- Insert into results history
  INSERT INTO results_history (game_id, result) VALUES (p_game_id, p_result);

  -- Mark bets as won/lost and credit winnings
  FOR bet_record IN SELECT id, user_id, amount FROM bets WHERE game_id = p_game_id AND status = 'pending' LOOP
    IF CAST(p_result AS integer) = (SELECT selected_number FROM bets WHERE id = bet_record.id) THEN
      UPDATE bets SET status = 'won', payout = bet_record.amount * 9 WHERE id = bet_record.id;
      UPDATE profiles SET coins = coins + bet_record.amount * 9 WHERE id = bet_record.user_id;
    ELSE
      UPDATE bets SET status = 'lost', payout = 0 WHERE id = bet_record.id;
    END IF;
  END LOOP;
END;
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id, display_name, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'Player'), COALESCE(NEW.raw_user_meta_data->>'phone', ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_game_id ON bets(game_id);
CREATE INDEX IF NOT EXISTS idx_results_game_id ON results_history(game_id);


/*
  HRIVOX 900 — settle engine upgrade
  - next_result_at on games
  - seed 5 games
  - place_bets, settle_game_round, settle_due_games, admin_credit_coins
  - payout 1 → 8
  - winner = lowest total bet (tie = smallest digit)
  - harden profile coin updates
*/

-- Extend games
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_result_at timestamptz;

-- Seed 5 games if empty
INSERT INTO games (name, short_code, schedule_time, result, is_active, next_result_at)
SELECT * FROM (VALUES
  ('Shri Ganesh', 'SG', 'Hourly', '', true, now() + interval '1 hour'),
  ('Faridabad', 'FB', 'Hourly', '', true, now() + interval '1 hour'),
  ('Ghaziabad', 'GZ', 'Hourly', '', true, now() + interval '1 hour'),
  ('Gali', 'GL', 'Hourly', '', true, now() + interval '1 hour'),
  ('Desawar', 'DW', 'Hourly', '', true, now() + interval '1 hour')
) AS v(name, short_code, schedule_time, result, is_active, next_result_at)
WHERE NOT EXISTS (SELECT 1 FROM games LIMIT 1);

-- Backfill next_result_at for existing rows
UPDATE games
SET next_result_at = COALESCE(next_result_at, now() + interval '1 hour')
WHERE next_result_at IS NULL;

-- Profiles: users/admins can UPDATE; trigger blocks coin/admin tampering unless RPC bypass
DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  )
  WITH CHECK (
    auth.uid() = id
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
  );

CREATE OR REPLACE FUNCTION protect_profile_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.bypass_profile_guard', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true) THEN
    RETURN NEW;
  END IF;
  NEW.coins := OLD.coins;
  NEW.is_admin := OLD.is_admin;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile ON profiles;
CREATE TRIGGER trg_protect_profile
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_sensitive();-- Place bets atomically (debit coins)
CREATE OR REPLACE FUNCTION place_bets(p_game_id uuid, p_bets jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_game games%ROWTYPE;
  v_total integer := 0;
  v_coins integer;
  bet_item jsonb;
  v_num integer;
  v_amt integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF NOT v_game.is_active THEN
    RAISE EXCEPTION 'Game is OFF';
  END IF;
  IF v_game.next_result_at IS NOT NULL AND v_game.next_result_at - now() < interval '30 seconds' THEN
    RAISE EXCEPTION 'Betting closed for this round';
  END IF;

  IF p_bets IS NULL OR jsonb_typeof(p_bets) <> 'array' OR jsonb_array_length(p_bets) = 0 THEN
    RAISE EXCEPTION 'No bets provided';
  END IF;

  FOR bet_item IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    v_num := (bet_item->>'number')::integer;
    v_amt := (bet_item->>'amount')::integer;
    IF v_num IS NULL OR v_num < 0 OR v_num > 9 THEN
      RAISE EXCEPTION 'Invalid number';
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'Invalid amount';
    END IF;
    v_total := v_total + v_amt;
  END LOOP;

  SELECT coins INTO v_coins FROM profiles WHERE id = v_uid FOR UPDATE;
  IF v_coins IS NULL OR v_coins < v_total THEN
    RAISE EXCEPTION 'Insufficient coins';
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET coins = coins - v_total WHERE id = v_uid;

  FOR bet_item IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    INSERT INTO bets (user_id, game_id, selected_number, amount, status, payout)
    VALUES (
      v_uid,
      p_game_id,
      (bet_item->>'number')::integer,
      (bet_item->>'amount')::integer,
      'pending',
      0
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION place_bets(uuid, jsonb) TO authenticated;

-- Settle one game: lowest total pending bets wins; payout ×8
CREATE OR REPLACE FUNCTION settle_game_round(p_game_id uuid, p_override text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_winning integer;
  v_result text;
  bet_record RECORD;
  v_totals integer[] := ARRAY[0,0,0,0,0,0,0,0,0,0];
  v_min integer;
  i integer;
  v_has_bets boolean := false;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF p_override IS NOT NULL AND length(trim(p_override)) > 0 THEN
    v_winning := CAST(trim(p_override) AS integer);
    IF v_winning < 0 OR v_winning > 9 THEN
      RAISE EXCEPTION 'Override must be 0-9';
    END IF;
  ELSE
    FOR bet_record IN
      SELECT selected_number, SUM(amount)::integer AS total
      FROM bets
      WHERE game_id = p_game_id AND status = 'pending'
      GROUP BY selected_number
    LOOP
      v_has_bets := true;
      v_totals[bet_record.selected_number + 1] := bet_record.total;
    END LOOP;

    IF NOT v_has_bets THEN
      v_winning := floor(random() * 10)::integer;
    ELSE
      v_min := v_totals[1];
      v_winning := 0;
      FOR i IN 2..10 LOOP
        IF v_totals[i] < v_min THEN
          v_min := v_totals[i];
          v_winning := i - 1;
        END IF;
      END LOOP;
    END IF;
  END IF;

  v_result := v_winning::text;

  UPDATE games
  SET result = v_result,
      result_published_at = now(),
      next_result_at = now() + interval '1 hour'
  WHERE id = p_game_id;

  INSERT INTO results_history (game_id, result) VALUES (p_game_id, v_result);

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  FOR bet_record IN
    SELECT id, user_id, amount, selected_number
    FROM bets
    WHERE game_id = p_game_id AND status = 'pending'
  LOOP
    IF bet_record.selected_number = v_winning THEN
      UPDATE bets SET status = 'won', payout = bet_record.amount * 8 WHERE id = bet_record.id;
      UPDATE profiles SET coins = coins + (bet_record.amount * 8) WHERE id = bet_record.user_id;
    ELSE
      UPDATE bets SET status = 'lost', payout = 0 WHERE id = bet_record.id;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION settle_game_round(uuid, text) TO authenticated;

-- Admin-only wrapper for override / force settle
CREATE OR REPLACE FUNCTION admin_settle_game(p_game_id uuid, p_override text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  RETURN settle_game_round(p_game_id, p_override);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_settle_game(uuid, text) TO authenticated;

-- Settle all games that are due (callable by service role / cron / edge)
CREATE OR REPLACE FUNCTION settle_due_games()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g RECORD;
  v_count integer := 0;
BEGIN
  FOR g IN
    SELECT id FROM games
    WHERE is_active = true
      AND next_result_at IS NOT NULL
      AND next_result_at <= now()
  LOOP
    PERFORM settle_game_round(g.id, NULL);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION settle_due_games() TO service_role;
GRANT EXECUTE ON FUNCTION settle_due_games() TO authenticated;

-- Replace publish_game_result to use ×8 and advance next_result_at
CREATE OR REPLACE FUNCTION publish_game_result(p_game_id uuid, p_result text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  PERFORM settle_game_round(p_game_id, p_result);
END;
$$;

-- Admin credit coins
CREATE OR REPLACE FUNCTION admin_credit_coins(p_user_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Amount required';
  END IF;
  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET coins = GREATEST(0, coins + p_amount) WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_credit_coins(uuid, integer) TO authenticated;

-- Allow authenticated clients to trigger due settle (idempotent; only settles past due)
-- Useful when Edge Function is not yet scheduled; PlayScreen can poll this.
CREATE OR REPLACE FUNCTION try_settle_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN settle_due_games();
END;
$$;

GRANT EXECUTE ON FUNCTION try_settle_due() TO authenticated;


-- Confirm demo accounts + profiles
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
  coins = GREATEST(profiles.coins, EXCLUDED.coins),
  is_admin = EXCLUDED.is_admin;
