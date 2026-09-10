const MUTE_KEY = 'hrivox_muted';
const SPLASH_KEY = 'hrivox_splash_seen';

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('hrivox-mute', { detail: muted }));
}

export function shouldShowSplash(): boolean {
  try {
    // Show splash once per browser session
    return sessionStorage.getItem(SPLASH_KEY) !== '1';
  } catch {
    return true;
  }
}

export function markSplashSeen() {
  try {
    sessionStorage.setItem(SPLASH_KEY, '1');
  } catch {
    /* ignore */
  }
}
