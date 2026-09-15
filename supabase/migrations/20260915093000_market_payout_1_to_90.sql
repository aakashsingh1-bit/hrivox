-- Markets (Faridabad, etc.): payout 1 → 90
-- Play Harf (HF): payout 1 → 8 (unchanged)

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
  v_mult integer;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  v_max := CASE WHEN v_game.short_code = 'HF' THEN 9 ELSE 99 END;
  v_mult := CASE WHEN v_game.short_code = 'HF' THEN 8 ELSE 90 END;

  IF p_override IS NOT NULL AND length(trim(p_override)) > 0 THEN
    v_winning := CAST(trim(p_override) AS integer);
    IF v_winning < 0 OR v_winning > v_max THEN
      RAISE EXCEPTION 'Override must be 0-%', v_max;
    END IF;
  ELSE
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
      SET status = 'won', payout = bet_record.amount * v_mult
      WHERE id = bet_record.id;

      PERFORM set_config('app.bypass_profile_guard', 'on', true);
      UPDATE profiles
      SET coins = coins + (bet_record.amount * v_mult)
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
