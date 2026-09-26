-- Per-game min bet + crossing min (admin-configurable). Payout already on games.payout_multiplier.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS min_bet integer,
  ADD COLUMN IF NOT EXISTS min_bet_crossing integer;

-- Seed current product defaults
UPDATE public.games
SET min_bet = 100, min_bet_crossing = 10
WHERE short_code <> 'HF'
  AND (min_bet IS NULL OR min_bet <= 0 OR min_bet_crossing IS NULL OR min_bet_crossing <= 0);

UPDATE public.games
SET min_bet = 1, min_bet_crossing = 1
WHERE short_code = 'HF'
  AND (min_bet IS NULL OR min_bet <= 0);

ALTER TABLE public.games
  ALTER COLUMN min_bet SET DEFAULT 100,
  ALTER COLUMN min_bet_crossing SET DEFAULT 10;

UPDATE public.games SET min_bet = COALESCE(NULLIF(min_bet, 0), 100) WHERE short_code <> 'HF';
UPDATE public.games SET min_bet_crossing = COALESCE(NULLIF(min_bet_crossing, 0), 10) WHERE short_code <> 'HF';
UPDATE public.games SET min_bet = COALESCE(NULLIF(min_bet, 0), 1) WHERE short_code = 'HF';
UPDATE public.games SET min_bet_crossing = COALESCE(NULLIF(min_bet_crossing, 0), 1) WHERE short_code = 'HF';

ALTER TABLE public.games
  ALTER COLUMN min_bet SET NOT NULL,
  ALTER COLUMN min_bet_crossing SET NOT NULL;

CREATE OR REPLACE FUNCTION public.place_bets(p_game_id uuid, p_bets jsonb)
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
  v_closed boolean := false;
  v_min integer;
  v_min_cross integer;
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

  v_is_harf := (v_game.short_code = 'HF');
  v_min := GREATEST(1, COALESCE(NULLIF(v_game.min_bet, 0), CASE WHEN v_is_harf THEN 1 ELSE 100 END));
  v_min_cross := GREATEST(1, COALESCE(NULLIF(v_game.min_bet_crossing, 0), CASE WHEN v_is_harf THEN v_min ELSE 10 END));

  IF v_game.betting_closes_at IS NOT NULL THEN
    v_closed := (now() >= v_game.betting_closes_at);
  ELSIF v_game.next_result_at IS NOT NULL THEN
    v_closed := (v_game.next_result_at - now() < interval '30 seconds');
  END IF;
  IF v_closed THEN
    RAISE EXCEPTION 'Betting closed for this round';
  END IF;

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
    IF v_kind IS NOT NULL AND v_kind NOT IN ('open', 'close', 'jodi', 'crossing') THEN
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
    IF v_is_harf THEN
      IF v_amt < v_min THEN
        RAISE EXCEPTION 'Minimum bet Rs %', v_min;
      END IF;
    ELSIF v_kind = 'crossing' THEN
      IF v_amt < v_min_cross THEN
        RAISE EXCEPTION 'Minimum bet Rs %', v_min_cross;
      END IF;
    ELSIF v_kind IN ('open', 'close', 'jodi') THEN
      IF v_amt < v_min THEN
        RAISE EXCEPTION 'Minimum bet Rs %', v_min;
      END IF;
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

CREATE OR REPLACE FUNCTION public.admin_set_game_limits(
  p_game_id uuid,
  p_min_bet integer,
  p_min_bet_crossing integer,
  p_payout_multiplier integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_harf boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_min_bet IS NULL OR p_min_bet < 1 OR p_min_bet > 100000 THEN
    RAISE EXCEPTION 'Min bet must be 1–100000';
  END IF;
  IF p_min_bet_crossing IS NULL OR p_min_bet_crossing < 1 OR p_min_bet_crossing > 100000 THEN
    RAISE EXCEPTION 'Crossing min bet must be 1–100000';
  END IF;
  IF p_payout_multiplier IS NULL OR p_payout_multiplier < 1 OR p_payout_multiplier > 1000 THEN
    RAISE EXCEPTION 'Payout must be 1–1000 (win = stake × N)';
  END IF;

  SELECT short_code = 'HF' INTO v_is_harf FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  UPDATE games
  SET
    min_bet = p_min_bet,
    min_bet_crossing = CASE WHEN v_is_harf THEN p_min_bet ELSE p_min_bet_crossing END,
    payout_multiplier = p_payout_multiplier
  WHERE id = p_game_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_game_limits(uuid, integer, integer, integer) TO authenticated;
