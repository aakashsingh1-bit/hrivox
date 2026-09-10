-- Run in Supabase Dashboard → SQL Editor
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN ('admin@hrivox.com', 'player@hrivox.com');
