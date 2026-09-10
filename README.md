# HRIVOX 900

Mobile-first webapp (Vite + React + Supabase) for five hourly number games with auto settlement.

## Rules

- Games: Shri Ganesh, Faridabad, Ghaziabad, Gali, Desawar
- Bet numbers **0–9**; payout **1 → 8** coins on win
- Winning number = digit with the **lowest total coins** bet that round (tie → smallest digit)
- Round length: **1 hour** (`games.next_result_at`)
- Add Money: WhatsApp support (set `SUPPORT_WHATSAPP` in `src/lib/supabase.ts`)

## Setup

1. Create a Supabase project.
2. Run migrations in order from `supabase/migrations/` in the SQL editor (or `supabase db push`).
3. Copy `.env.example` → `.env` and set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev`
5. Sign up a user, then in Supabase SQL set admin:

```sql
UPDATE profiles SET is_admin = true WHERE id = '<user-uuid>';
```

## Auto settle

- Clients call `try_settle_due` on load/poll (works without cron).
- Production: deploy `supabase/functions/settle-games` and schedule every minute, **or** enable `pg_cron`:

```sql
select cron.schedule('settle-hrivox', '* * * * *', $$select settle_due_games();$$);
```

## Android APK later

Wrap this build with Capacitor (`npx cap add android`) pointing at the production URL or bundled `dist/`.

## Admin

Open **More → Open Panel** when `is_admin` is true: game ON/OFF, override 0–9, auto settle, credit coins, users & bets.
# hrivox
