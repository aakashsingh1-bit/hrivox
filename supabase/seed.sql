/*
  Seed demo accounts for local / staging use.
  Password for both: Password123!

  admin@hrivox.com  — is_admin = true, 5000 coins
  player@hrivox.com — regular user, 1000 coins
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  admin_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  player_id uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
  -- Admin auth user
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = admin_id) THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      admin_id,
      'authenticated',
      'authenticated',
      'admin@hrivox.com',
      crypt('Password123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"HRIVOX Admin","phone":"9000000001"}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      admin_id,
      admin_id,
      format('{"sub":"%s","email":"admin@hrivox.com"}', admin_id)::jsonb,
      'email',
      admin_id::text,
      now(), now(), now()
    );
  END IF;

  -- Player auth user
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = player_id) THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      player_id,
      'authenticated',
      'authenticated',
      'player@hrivox.com',
      crypt('Password123!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Demo Player","phone":"9000000002"}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      player_id,
      player_id,
      format('{"sub":"%s","email":"player@hrivox.com"}', player_id)::jsonb,
      'email',
      player_id::text,
      now(), now(), now()
    );
  END IF;
END $$;

-- Profiles (trigger may already create them; upsert to set roles/coins)
INSERT INTO profiles (id, display_name, phone, coins, is_admin)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'HRIVOX Admin', '9000000001', 5000, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Demo Player', '9000000002', 1000, false)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  phone = EXCLUDED.phone,
  coins = EXCLUDED.coins,
  is_admin = EXCLUDED.is_admin;

-- Ensure 5 market games exist with next_result_at
INSERT INTO games (name, short_code, schedule_time, result, is_active, next_result_at)
SELECT * FROM (VALUES
  ('Shri Ganesh', 'SG', 'Hourly', '', true, now() + interval '1 hour'),
  ('Faridabad', 'FB', 'Hourly', '', true, now() + interval '1 hour'),
  ('Ghaziabad', 'GZ', 'Hourly', '', true, now() + interval '1 hour'),
  ('Gali', 'GL', 'Hourly', '', true, now() + interval '1 hour'),
  ('Desawar', 'DW', 'Hourly', '', true, now() + interval '1 hour')
) AS v(name, short_code, schedule_time, result, is_active, next_result_at)
WHERE NOT EXISTS (SELECT 1 FROM games WHERE short_code = 'SG' LIMIT 1);

-- Standalone Play Harf (separate from markets)
INSERT INTO games (name, short_code, schedule_time, result, is_active, next_result_at)
SELECT 'Harf', 'HF', 'Hourly', '', true, now() + interval '1 hour'
WHERE NOT EXISTS (SELECT 1 FROM games WHERE short_code = 'HF');

UPDATE games
SET next_result_at = COALESCE(next_result_at, now() + interval '1 hour')
WHERE next_result_at IS NULL;
