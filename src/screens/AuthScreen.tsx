import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Eye, EyeOff } from 'lucide-react';

function readRefFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('ref') || '';
  } catch {
    return '';
  }
}

export function AuthScreen() {
  const { signIn, signUp, setupError } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState(readRefFromUrl);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    if (mode === 'signup') {
      const { error } = await signUp(email, password, displayName, phone, referralCode.trim());
      if (error) setError(error);
      // On success, session is set by AuthProvider — app opens automatically.
    } else {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    }
    setBusy(false);
  };

  const banner = error || setupError;

  return (
    <div className="auth-app">
      <div className="auth-hero">
        <img src="/logo.png" alt="HRIVOX 900" className="auth-logo" />
        <h1>
          HRIVOX <span>900</span>
        </h1>
        <p>Play · Win · Grow</p>
      </div>

      <div className="auth-body">
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Login
          </button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <>
              <label className="auth-field">
                <span>Display Name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                />
              </label>
              <label className="auth-field">
                <span>Phone Number</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Mobile number"
                  autoComplete="tel"
                />
              </label>
              <label className="auth-field">
                <span>Invite code (optional)</span>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  placeholder="Friend's code"
                  autoComplete="off"
                />
              </label>
            </>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <div className="password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="eye-toggle">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {banner && <div className={`auth-error ${banner.includes('created') ? 'success' : ''}`}>{banner}</div>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>

        <p className="auth-note">Markets 1 → 90 · Harf 1 → 8</p>
      </div>
    </div>
  );
}
