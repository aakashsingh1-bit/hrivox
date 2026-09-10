# HRIVOX 900

Production mobile app shell (Vite + React + Supabase + Capacitor) for five hourly number games.

**Client review guide:** see [`CLIENT_REVIEW.md`](./CLIENT_REVIEW.md)

## Game rules

- Markets: Shri Ganesh, Faridabad, Ghaziabad, Gali, Desawar  
- Numbers **0–9** · payout **1 → 8** on win  
- Winner = digit with the **lowest total coins** bet (tie → smallest digit)  
- Cycle: **1 hour** per round  
- Add Money: WhatsApp (`SUPPORT_WHATSAPP` in `src/lib/supabase.ts`)

## Quick start (web)

```bash
npm install
cp .env.example .env   # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

Production web build:

```bash
npm run build
npm run preview
```

## Android APK

```bash
npm run build
npx cap sync android
npx cap open android
```

Then **Build → Build APK(s)** in Android Studio.  
Requires JDK 17+ and Android Studio on the build machine.

## Admin

Sign in as an admin user → **More → Open Panel**  
Live digit totals, override, auto settle, credit coins, users & history.

## Auto settle

Clients poll `try_settle_due`. For production, also schedule:

```sql
select cron.schedule('settle-hrivox', '* * * * *', $$select settle_due_games();$$);
```

or deploy `supabase/functions/settle-games`.
