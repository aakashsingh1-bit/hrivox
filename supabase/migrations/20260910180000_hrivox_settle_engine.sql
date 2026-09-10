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
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

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
