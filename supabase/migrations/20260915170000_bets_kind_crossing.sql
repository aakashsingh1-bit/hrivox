-- Allow Crossing bets: bet_kind = 'crossing'
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_bet_kind_check;
ALTER TABLE bets ADD CONSTRAINT bets_bet_kind_check
  CHECK (bet_kind IS NULL OR bet_kind IN ('open', 'close', 'jodi', 'crossing'));
