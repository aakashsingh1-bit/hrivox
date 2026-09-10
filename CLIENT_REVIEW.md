# HRIVOX 900 — Client Review Handoff

**Status:** Development complete · ready for client UAT / review  
**Build:** v1.0.0 · production web + Capacitor Android project scaffolded

---

## What is delivered

| Area | Status |
|------|--------|
| Player app (Home / Play Game / Play Harf / Account / More) | Ready |
| Login / Sign up (full-screen mobile) | Ready |
| Wheel + arrow spin, spark on stop | Ready |
| Win / Loss popup after hourly result | Ready |
| Admin panel (Overview / Games live totals / Users / Bets / Results) | Ready |
| Rules: lowest bet wins · payout **1 → 8** · **1 hour** cycle | Live on server |
| Android Capacitor project (`android/`) | Scaffolded — open in Android Studio to export APK |

---

## Review credentials (demo)

| Role | Email | Password |
|------|--------|----------|
| **Admin** | `admin@hrivox.com` | `Password123!` |
| **Player** | `player@hrivox.com` | `Password123!` |

Admin: open **More → Open Panel**.  
Player: place bets on Play Game / Play Harf.

> Change these passwords before public launch.

---

## How to review (web)

1. Open the hosted web URL (or run locally):
   ```bash
   npm install
   npm run build
   npm run preview
   ```
2. Log in with the credentials above on a phone or Chrome device toolbar.
3. Suggested checks:
   - Place a bet → wallet decreases · arrow stops on selected number · spark
   - Admin Games tab → digit totals update live when players bet (no manual refresh)
   - Wait for / force settle (Admin → Auto settle) → win/loss popup for players who bet
   - Logout from Account / More / Settings

---

## How to build Android APK (on a machine with Android Studio)

```bash
npm install
npm run build
npx cap sync android
npx cap open android
```

In Android Studio:

1. Wait for Gradle sync  
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**  
3. Or run on a device/emulator with the green Run button  

Debug APK path (typical):

`android/app/build/outputs/apk/debug/app-debug.apk`

For Play Store / signed release: **Build → Generate Signed Bundle / APK**.

---

## Production rules (already on server)

- 5 games: Shri Ganesh, Faridabad, Ghaziabad, Gali, Desawar  
- Numbers **0–9**  
- Winner = number with **lowest total coins** that round (tie → smallest digit)  
- Win payout = **stake × 8**  
- Round = **1 hour**; betting closes in last **30 seconds**  
- Add Money → WhatsApp (`SUPPORT_WHATSAPP` in `src/lib/supabase.ts` — update number for go-live)

---

## Environment

Client build uses:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

See `.env.example`. Do **not** ship service-role keys in the app.

---

## Contact / next after UAT

After client sign-off:

1. Replace WhatsApp support number  
2. Rotate demo passwords / create real admin accounts  
3. Signed release APK + optional Play Store listing  
4. Optional: pg_cron / edge function for settle every minute (clients also call `try_settle_due`)
