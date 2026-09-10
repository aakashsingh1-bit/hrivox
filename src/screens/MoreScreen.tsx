import { useAuth } from '@/lib/auth';
import { openAddMoneyWhatsApp } from '@/lib/supabase';
import { playTap } from '@/lib/sounds';
import {
  ChevronRight,
  CircleHelp,
  Clock3,
  Info,
  ListOrdered,
  LogOut,
  MessageCircle,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type { Tab } from '@/components/AppShell';

export type MorePage = 'menu' | 'how' | 'timings' | 'results' | 'settings';

export function MoreScreen({
  onNavigate,
  onOpenPage,
}: {
  onNavigate: (tab: Tab) => void;
  onOpenPage: (page: MorePage) => void;
}) {
  const { profile, signOut } = useAuth();

  const items: { title: string; subtitle: string; Icon: typeof CircleHelp; action: () => void }[] = [
    {
      title: 'How it works',
      subtitle: 'Pick 0–9, wait 1 hour, lowest-bet number wins (1→8)',
      Icon: CircleHelp,
      action: () => onOpenPage('how'),
    },
    {
      title: 'Game timings',
      subtitle: 'Live countdowns for all 5 markets',
      Icon: Clock3,
      action: () => onOpenPage('timings'),
    },
    {
      title: 'Previous results',
      subtitle: 'Full published result archive',
      Icon: ListOrdered,
      action: () => onOpenPage('results'),
    },
    {
      title: 'Add money / Support',
      subtitle: 'WhatsApp support for coin top-up',
      Icon: MessageCircle,
      action: () => openAddMoneyWhatsApp(),
    },
    {
      title: 'Settings',
      subtitle: 'Sound, support, and account info',
      Icon: Settings,
      action: () => onOpenPage('settings'),
    },
  ];

  return (
    <div className="more-screen page-screen">
      <div className="more-hero">
        <img src="/logo.png" alt="HRIVOX 900" className="auth-logo" />
        <h1>HRIVOX 900</h1>
        <p>Play · Win · Grow</p>
      </div>

      {profile?.is_admin && (
        <div className="admin-notice">
          <ShieldCheck size={18} />
          <div>
            <strong>Admin access</strong>
            <p>Manage games, results, and user coins.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              playTap();
              onNavigate('admin');
            }}
          >
            Open Panel <ChevronRight size={14} />
          </button>
        </div>
      )}

      <div className="menu-list">
        {items.map(({ title, subtitle, Icon, action }) => (
          <button
            key={title}
            type="button"
            onClick={() => {
              playTap();
              action();
            }}
          >
            <span className="menu-icon">
              <Icon size={18} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>

      <div className="about-card">
        <Info size={18} />
        <div>
          <strong>Result rule</strong>
          <p>
            Every hour the number with the least total coins bet becomes the result. Winning bets receive 8 coins
            for each 1 coin staked. Admin can override or correct results.
          </p>
        </div>
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
    </div>
  );
}
