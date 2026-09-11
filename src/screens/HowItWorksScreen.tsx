import { ArrowLeft, Coins, Timer, Trophy, CircleDot, Gamepad2 } from 'lucide-react';

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
              Open Play Game, pick a market (Shri Ganesh, Faridabad, Ghaziabad, Gali, Desawar), then use Open
              Game, Jantari, or Crossing to place bets.
            </p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><CircleDot size={18} /></span>
          <div>
            <strong>Play Harf</strong>
            <p>
              Play Harf is its own game (not a market list). Enter amounts on digits 0–9 on the wheel and tap{' '}
              <b>Bet Ok</b>.
            </p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><Coins size={18} /></span>
          <div>
            <strong>Place your bet</strong>
            <p>Coins are taken from your wallet when you confirm. You can bet on multiple numbers in one go.</p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><Timer size={18} /></span>
          <div>
            <strong>Wait for the hour</strong>
            <p>Each game settles about every 1 hour. Betting closes in the last 30 seconds of the round.</p>
          </div>
        </li>
        <li>
          <span className="info-step-icon"><Trophy size={18} /></span>
          <div>
            <strong>Lowest total wins</strong>
            <p>
              The number with the <b>least total coins bet</b> becomes the result (ties → smallest number).
              Winners get <b>8 coins for every 1 coin</b> staked.
            </p>
          </div>
        </li>
      </ol>

      <div className="info-callout">
        <strong>Example</strong>
        <p>You bet 10 coins on 7. If 7 is the result, you receive 80 coins payout (net +70 after stake).</p>
      </div>
    </div>
  );
}
