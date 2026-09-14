-- Market Jodi / Jantari / Crossing: min ₹100, no final-hour ₹200 cap.
-- Harf (HF) keeps final-hour max ₹200.

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
  v_is_harf boolean := false;
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

  v_is_harf := (v_game.short_code = 'HF');

  IF v_is_harf AND v_game.next_result_at IS NOT NULL AND v_game.next_result_at - now() <= interval '1 hour' THEN
    v_final_hour := true;
  END IF;

  IF p_bets IS NULL OR jsonb_typeof(p_bets) <> 'array' OR jsonb_array_length(p_bets) = 0 THEN
    RAISE EXCEPTION 'No bets provided';
  END IF;

  v_max := CASE WHEN v_is_harf THEN 9 ELSE 99 END;

  FOR bet_item IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    v_num := (bet_item->>'number')::integer;
    v_amt := (bet_item->>'amount')::integer;
    v_kind := lower(nullif(trim(COALESCE(bet_item->>'kind', '')), ''));
    IF v_kind IS NULL THEN
      v_kind := CASE WHEN v_is_harf THEN NULL ELSE 'jodi' END;
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
    IF NOT v_is_harf AND v_amt < 100 THEN
      RAISE EXCEPTION 'Minimum bet Rs 100';
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
      v_kind := CASE WHEN v_is_harf THEN NULL ELSE 'jodi' END;
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
