-- Standalone Play Harf game (separate from market games).
-- Harf uses digits 0–9 only; markets keep 0–99.

INSERT INTO games (name, short_code, schedule_time, result, is_active, next_result_at)
SELECT 'Harf', 'HF', 'Hourly', '', true, now() + interval '1 hour'
WHERE NOT EXISTS (SELECT 1 FROM games WHERE short_code = 'HF');

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
  v_max integer;
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

  v_max := CASE WHEN v_game.short_code = 'HF' THEN 9 ELSE 99 END;

  FOR bet_item IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    v_num := (bet_item->>'number')::integer;
    v_amt := (bet_item->>'amount')::integer;
    IF v_num IS NULL OR v_num < 0 OR v_num > v_max THEN
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
    SELECT true INTO v_has_bets
    FROM bets
    WHERE game_id = p_game_id AND status = 'pending'
    LIMIT 1;

    IF NOT COALESCE(v_has_bets, false) THEN
      -- Empty round: Harf always 0–9; markets default 0–9 wheel style
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

  UPDATE bets
  SET status = 'lost', payout = 0
  WHERE game_id = p_game_id AND status = 'pending' AND selected_number <> v_winning;

  FOR bet_record IN
    SELECT * FROM bets
    WHERE game_id = p_game_id AND status = 'pending' AND selected_number = v_winning
  LOOP
    UPDATE bets
    SET status = 'won', payout = bet_record.amount * 8
    WHERE id = bet_record.id;

    PERFORM set_config('app.bypass_profile_guard', 'on', true);
    UPDATE profiles
    SET coins = coins + (bet_record.amount * 8)
    WHERE id = bet_record.user_id;
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
