-- V2: bet cap final hour, bet_kind, external names, referral, settle win rules, Harf-only auto settle

-- ── Schema ──────────────────────────────────────────────────────────────
ALTER TABLE bets ADD COLUMN IF NOT EXISTS bet_kind text;
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_bet_kind_check;
ALTER TABLE bets ADD CONSTRAINT bets_bet_kind_check
  CHECK (bet_kind IS NULL OR bet_kind IN ('open', 'close', 'jodi'));

ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_selected_number_check;
ALTER TABLE bets ADD CONSTRAINT bets_selected_number_check
  CHECK (selected_number >= 0 AND selected_number <= 99);

ALTER TABLE games ADD COLUMN IF NOT EXISTS external_name text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_scraped_result text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_scraped_at timestamptz;

UPDATE games SET external_name = 'SHRI GANESH' WHERE short_code = 'SG' AND (external_name IS NULL OR external_name = '');
UPDATE games SET external_name = 'FARIDABAD' WHERE short_code = 'FB' AND (external_name IS NULL OR external_name = '');
UPDATE games SET external_name = 'GHAZIABAD' WHERE short_code = 'GZ' AND (external_name IS NULL OR external_name = '');
UPDATE games SET external_name = 'GALI' WHERE short_code = 'GL' AND (external_name IS NULL OR external_name = '');
UPDATE games SET external_name = 'DESAWAR' WHERE short_code = 'DW' AND (external_name IS NULL OR external_name = '');

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_uidx
  ON profiles (referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  note text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coins integer NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now(),
  UNIQUE (referred_id)
);

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deposits_select" ON deposits;
CREATE POLICY "deposits_select" ON deposits FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "referral_rewards_select" ON referral_rewards;
CREATE POLICY "referral_rewards_select" ON referral_rewards FOR SELECT TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id OR public.is_admin());

-- Backfill referral codes
UPDATE profiles
SET referral_code = upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE referral_code IS NULL OR referral_code = '';

-- ── place_bets (₹200 in final hour + bet_kind) ───────────────────────
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
  v_kind text;
  v_max integer;
  v_final_hour boolean := false;
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

  IF v_game.next_result_at IS NOT NULL AND v_game.next_result_at - now() <= interval '1 hour' THEN
    v_final_hour := true;
  END IF;

  IF p_bets IS NULL OR jsonb_typeof(p_bets) <> 'array' OR jsonb_array_length(p_bets) = 0 THEN
    RAISE EXCEPTION 'No bets provided';
  END IF;

  v_max := CASE WHEN v_game.short_code = 'HF' THEN 9 ELSE 99 END;

  FOR bet_item IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    v_num := (bet_item->>'number')::integer;
    v_amt := (bet_item->>'amount')::integer;
    v_kind := lower(nullif(trim(COALESCE(bet_item->>'kind', '')), ''));
    IF v_kind IS NULL THEN
      v_kind := CASE WHEN v_game.short_code = 'HF' THEN NULL ELSE 'jodi' END;
    END IF;
    IF v_kind IS NOT NULL AND v_kind NOT IN ('open', 'close', 'jodi') THEN
      RAISE EXCEPTION 'Invalid bet kind';
    END IF;
    IF v_kind IN ('open', 'close') THEN
      IF v_num IS NULL OR v_num < 0 OR v_num > 9 THEN
        RAISE EXCEPTION 'Invalid number';
      END IF;
    ELSE
      IF v_num IS NULL OR v_num < 0 OR v_num > v_max THEN
        RAISE EXCEPTION 'Invalid number';
      END IF;
    END IF;
    IF v_amt IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'Invalid amount';
    END IF;
    IF v_final_hour AND v_amt > 200 THEN
      RAISE EXCEPTION 'Max bet Rs 200 in final hour';
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
    v_kind := lower(nullif(trim(COALESCE(bet_item->>'kind', '')), ''));
    IF v_kind IS NULL THEN
      v_kind := CASE WHEN v_game.short_code = 'HF' THEN NULL ELSE 'jodi' END;
    END IF;
    INSERT INTO bets (user_id, game_id, selected_number, amount, status, payout, bet_kind)
    VALUES (
      v_uid,
      p_game_id,
      (bet_item->>'number')::integer,
      (bet_item->>'amount')::integer,
      'pending',
      0,
      v_kind
    );
  END LOOP;
END;
$$;

-- ── settle_game_round (open/close/jodi + Harf lowest-bet) ─────────────
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
  v_has_bets boolean := false;
  v_max integer;
  v_tens integer;
  v_units integer;
  v_is_win boolean;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  v_max := CASE WHEN v_game.short_code = 'HF' THEN 9 ELSE 99 END;

  IF p_override IS NOT NULL AND length(trim(p_override)) > 0 THEN
    v_winning := CAST(trim(p_override) AS integer);
    IF v_winning < 0 OR v_winning > v_max THEN
      RAISE EXCEPTION 'Override must be 0-%', v_max;
    END IF;
  ELSE
    -- Markets must be settled via scraped/admin override (1A)
    IF v_game.short_code <> 'HF' THEN
      RAISE EXCEPTION 'Market settle requires official result override';
    END IF;

    SELECT true INTO v_has_bets
    FROM bets
    WHERE game_id = p_game_id AND status = 'pending'
    LIMIT 1;

    IF NOT COALESCE(v_has_bets, false) THEN
      v_winning := floor(random() * 10)::integer;
    ELSE
      SELECT selected_number INTO v_winning
      FROM (
        SELECT selected_number, SUM(amount)::integer AS total
        FROM bets
        WHERE game_id = p_game_id AND status = 'pending'
        GROUP BY selected_number
      ) t
      ORDER BY total ASC, selected_number ASC
      LIMIT 1;
    END IF;
  END IF;

  v_result := v_winning::text;
  v_tens := (v_winning / 10) % 10;
  v_units := v_winning % 10;

  FOR bet_record IN
    SELECT * FROM bets
    WHERE game_id = p_game_id AND status = 'pending'
  LOOP
    v_is_win := false;
    IF v_game.short_code = 'HF' OR COALESCE(bet_record.bet_kind, 'jodi') = 'jodi'
       OR bet_record.bet_kind IS NULL THEN
      IF bet_record.selected_number = v_winning THEN
        v_is_win := true;
      END IF;
    ELSIF bet_record.bet_kind = 'open' THEN
      IF bet_record.selected_number = v_tens THEN
        v_is_win := true;
      END IF;
    ELSIF bet_record.bet_kind = 'close' THEN
      IF bet_record.selected_number = v_units THEN
        v_is_win := true;
      END IF;
    END IF;

    IF v_is_win THEN
      UPDATE bets
      SET status = 'won', payout = bet_record.amount * 8
      WHERE id = bet_record.id;

      PERFORM set_config('app.bypass_profile_guard', 'on', true);
      UPDATE profiles
      SET coins = coins + (bet_record.amount * 8)
      WHERE id = bet_record.user_id;
    ELSE
      UPDATE bets
      SET status = 'lost', payout = 0
      WHERE id = bet_record.id;
    END IF;
  END LOOP;

  UPDATE games
  SET
    result = v_result,
    result_published_at = now(),
    next_result_at = now() + interval '1 hour'
  WHERE id = p_game_id;

  INSERT INTO results_history (game_id, result, published_at)
  VALUES (p_game_id, v_result, now());

  RETURN v_result;
END;
$$;

-- Auto-settle only Harf (markets wait for scrape/admin)
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
      AND short_code = 'HF'
      AND next_result_at IS NOT NULL
      AND next_result_at <= now()
  LOOP
    PERFORM settle_game_round(g.id, NULL);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Service-role settle with override (used by scrape edge function)
CREATE OR REPLACE FUNCTION service_settle_game(p_game_id uuid, p_override text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_override IS NULL OR length(trim(p_override)) = 0 THEN
    RAISE EXCEPTION 'Override required';
  END IF;
  RETURN settle_game_round(p_game_id, trim(p_override));
END;
$$;

GRANT EXECUTE ON FUNCTION service_settle_game(uuid, text) TO service_role;

-- ── Referral / deposits ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ensure_referral_code(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT referral_code INTO v_code FROM profiles WHERE id = p_user_id;
  IF v_code IS NULL OR v_code = '' THEN
    v_code := upper(substr(replace(p_user_id::text, '-', ''), 1, 8));
    UPDATE profiles SET referral_code = v_code WHERE id = p_user_id;
  END IF;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_referral_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION apply_referral_code(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ref uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN;
  END IF;

  SELECT id INTO v_ref
  FROM profiles
  WHERE upper(referral_code) = upper(trim(p_code))
  LIMIT 1;

  IF v_ref IS NULL OR v_ref = v_uid THEN
    RETURN;
  END IF;

  UPDATE profiles
  SET referred_by = v_ref
  WHERE id = v_uid
    AND referred_by IS NULL
    AND id <> v_ref;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_referral_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION try_referral_reward(p_referred_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer uuid;
  v_sum integer;
BEGIN
  SELECT referred_by INTO v_referrer FROM profiles WHERE id = p_referred_id;
  IF v_referrer IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM referral_rewards WHERE referred_id = p_referred_id) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(SUM(amount), 0)::integer INTO v_sum
  FROM deposits
  WHERE user_id = p_referred_id AND status = 'confirmed';

  IF v_sum < 2000 THEN
    RETURN false;
  END IF;

  INSERT INTO referral_rewards (referrer_id, referred_id, coins)
  VALUES (v_referrer, p_referred_id, 100);

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET coins = coins + 100 WHERE id = v_referrer;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION try_referral_reward(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION try_referral_reward(uuid) TO service_role;

CREATE OR REPLACE FUNCTION admin_record_deposit(p_user_id uuid, p_amount integer, p_note text DEFAULT '')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount required';
  END IF;

  INSERT INTO deposits (user_id, amount, status, note, created_by)
  VALUES (p_user_id, p_amount, 'confirmed', COALESCE(p_note, ''), auth.uid())
  RETURNING id INTO v_id;

  -- Also credit coins equal to deposit amount (1 coin = Rs 1 for V2)
  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET coins = coins + p_amount WHERE id = p_user_id;

  PERFORM try_referral_reward(p_user_id);
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_record_deposit(uuid, integer, text) TO authenticated;
