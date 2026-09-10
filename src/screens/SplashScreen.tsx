import { useEffect } from 'react';
import { markSplashSeen } from '@/lib/prefs';
import { playSplash, unlockAudio } from '@/lib/sounds';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    unlockAudio();
    playSplash();
    const t = window.setTimeout(() => {
      markSplashSeen();
      onDone();
    }, 2200);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div className="splash-screen" onClick={() => unlockAudio()} role="presentation">
      <div className="splash-glow" />
      <img src="/logo.png" alt="HRIVOX 900" className="splash-logo" />
      <h1 className="splash-title">
        HRIVOX <span>900</span>
      </h1>
      <p className="splash-tag">Play · Win · Grow</p>
      <div className="splash-bar">
        <span />
      </div>
    </div>
  );
}
