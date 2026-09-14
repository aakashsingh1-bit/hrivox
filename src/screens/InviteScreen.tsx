import { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Share2, Gift } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { playTap } from '@/lib/sounds';

export function InviteScreen({ onBack }: { onBack: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const [code, setCode] = useState(profile?.referral_code || '');
  const [toast, setToast] = useState('');
  const [rewarded, setRewarded] = useState(0);

  useEffect(() => {
    void (async () => {
      if (!profile) return;
      const { data } = await supabase.rpc('ensure_referral_code', { p_user_id: profile.id });
      if (typeof data === 'string') setCode(data);
      await refreshProfile();
      const { count } = await supabase
        .from('referral_rewards')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', profile.id);
      setRewarded(count ?? 0);
    })();
  }, [profile?.id]);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2200);
  };

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code || '')}`
      : '';

  const copy = async () => {
    playTap();
    try {
      await navigator.clipboard.writeText(link || code);
      notify('Copied');
    } catch {
      notify(code);
    }
  };

  const share = async () => {
    playTap();
    const text = `Join HRIVOX 900 with my code ${code}. Get started and play! ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'HRIVOX 900', text, url: link });
      } catch {
        /* cancelled */
      }
    } else {
      await copy();
    }
  };

  return (
    <div className="info-screen page-screen">
      <div className="page-title-row">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="small-label">REWARDS</span>
          <h1>Invite & Earn</h1>
        </div>
      </div>

      <div className="invite-card">
        <Gift size={28} />
        <strong>Earn 100 coins</strong>
        <p>
          When a new user signs up with your code and deposits <b>Rs 2,000+</b>, you receive{' '}
          <b>100 coins</b> once per referral. Duplicate or fake accounts may be excluded.
        </p>
        <div className="invite-code">{code || '…'}</div>
        <div className="invite-actions">
          <button type="button" onClick={copy}>
            <Copy size={16} /> Copy link
          </button>
          <button type="button" className="primary" onClick={share}>
            <Share2 size={16} /> Share
          </button>
        </div>
        <small className="invite-meta">Successful rewards: {rewarded}</small>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
