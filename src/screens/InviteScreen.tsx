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

  const shareText = `Join HRIVOX 900!\nUse my invite code: ${code}\nSign up in the app and enter this code. When you deposit Rs 2,000+, I earn rewards. Play now!`;

  const copy = async () => {
    playTap();
    try {
      await navigator.clipboard.writeText(code);
      notify('Code copied');
    } catch {
      notify(code);
    }
  };

  const share = async () => {
    playTap();
    if (navigator.share) {
      try {
        await navigator.share({ title: 'HRIVOX 900 Invite', text: shareText });
      } catch {
        /* cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareText);
        notify('Invite message copied');
      } catch {
        notify(code);
      }
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
          Share your code with friends. When a new user signs up with your code and deposits{' '}
          <b>Rs 2,000+</b>, you receive <b>100 coins</b> once per referral.
        </p>
        <div className="invite-code">{code || '…'}</div>
        <div className="invite-actions">
          <button type="button" onClick={copy}>
            <Copy size={16} /> Copy code
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
