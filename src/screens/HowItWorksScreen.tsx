import { ArrowLeft, Timer, Trophy, CircleDot, Gamepad2, ListOrdered } from 'lucide-react';

export function HowItWorksScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="info-screen page-screen">
      <div className="page-title-row">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="small-label">HELP</span>
          <h1>How it works</h1>
        </div>
      </div>

      <ol className="info-steps">
        <li>
          <span className="info-step-icon"><Gamepad2 size={18} /></span>
          <div>
            <strong>Play Game</strong>
            <p>
              Pick a market, then Open Game / Jantari (Dhai Open + Harup Close) / Crossing (up to 8 digits). Tap
              Continue. Max <b>Rs 200</b> per number in the final hour.
            </p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><CircleDot size={18} /></span>
          <div>
            <strong>Play Harf</strong>
            <p>Separate wheel game (0–9). Lowest total bet wins that round.</p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><Timer size={18} /></span>
          <div>
            <strong>Where to see the result</strong>
            <p>
              After Continue, stay on the market screen. When the official result is published you get a
              win/lose popup. The Play Game list and market screen show the digit in <b>red</b>. Also: Home,
              Account history, More → Previous results (last 1 month).
            </p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><ListOrdered size={18} /></span>
          <div>
            <strong>Market results</strong>
            <p>
              Markets use the official published result (automated fetch + admin override). Open bets match the
              tens digit; Close match the units; Jodi matches the full number.
            </p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><Trophy size={18} /></span>
          <div>
            <strong>Payout</strong>
            <p>
              Winners get <b>8 coins for every 1 coin</b> staked. Invite & Earn: 100 coins when a referred user
              deposits Rs 2,000+.
            </p>
          </div>
        </li>
      </ol>

      <div className="info-callout">
        <strong>Example</strong>
        <p>You bet 10 coins on jodi 57. If result is 57, you receive 80 coins payout.</p>
      </div>
    </div>
  );
}
