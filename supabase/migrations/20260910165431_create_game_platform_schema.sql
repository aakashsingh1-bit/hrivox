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
