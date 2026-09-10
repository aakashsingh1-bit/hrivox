import { useEffect, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX, MessageCircle, ShieldCheck, LogOut } from 'lucide-react';
import { isMuted, setMuted } from '@/lib/prefs';
import { playTap, unlockAudio } from '@/lib/sounds';
import { openAddMoneyWhatsApp, SUPPORT_WHATSAPP } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { profile, signOut } = useAuth();
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    const onMute = (e: Event) => setMutedState(Boolean((e as CustomEvent).detail));
    window.addEventListener('hrivox-mute', onMute);
    return () => window.removeEventListener('hrivox-mute', onMute);
  }, []);

  const toggleMute = () => {
    unlockAudio();
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) playTap();
  };

  return (
    <div className="info-screen page-screen">
      <div className="page-title-row">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="small-label">APP</span>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="settings-card">
        <div>
          <strong>Sound effects</strong>
          <small>Wheel spin, bet confirm, and win tones</small>
        </div>
        <button type="button" className={`settings-toggle ${muted ? '' : 'on'}`} onClick={toggleMute}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          {muted ? 'Off' : 'On'}
        </button>
      </div>

      <div className="settings-card">
        <div>
          <strong>Support WhatsApp</strong>
          <small>+{SUPPORT_WHATSAPP}</small>
        </div>
        <button type="button" className="settings-action" onClick={() => openAddMoneyWhatsApp()}>
          <MessageCircle size={16} /> Chat
        </button>
      </div>

      <div className="settings-card static">
        <div>
          <strong>Signed in as</strong>
          <small>
            {profile?.display_name} · {profile?.phone || 'no phone'}
            {profile?.is_admin ? ' · Admin' : ''}
          </small>
        </div>
        <ShieldCheck size={18} color="#238fd2" />
      </div>

      <button
        type="button"
        className="logout-button"
        onClick={async () => {
          playTap();
          await signOut();
        }}
      >
        <LogOut size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Logout
      </button>

      <p className="settings-version">HRIVOX 900 · v1.0.0</p>
    </div>
  );
}
