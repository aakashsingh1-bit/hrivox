import { useAuth } from '@/lib/auth';
import { openAddMoneyWhatsApp, openWithdrawWhatsApp } from '@/lib/supabase';
import { playTap } from '@/lib/sounds';
import {
  ChevronRight,
  CircleHelp,
  Clock3,
  Gift,
  Info,
  ListOrdered,
  LogOut,
  MessageCircle,
  Banknote,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import type { Tab } from '@/components/AppShell';

export type MorePage = 'menu' | 'how' | 'timings' | 'results' | 'settings' | 'invite';

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
      title: 'Invite & Earn',
      subtitle: '100 coins when friend deposits Rs 2,000+',
      Icon: Gift,
      action: () => onOpenPage('invite'),
    },
    {
      title: 'How it works',
      subtitle: 'Markets, Harf, and payout rules',
      Icon: CircleHelp,
      action: () => onOpenPage('how'),
    },
    {
      title: 'Game timings',
      subtitle: 'Live countdowns for markets + Harf',
      Icon: Clock3,
      action: () => onOpenPage('timings'),
    },
    {
      title: 'Previous results',
      subtitle: 'Last 1 month of published results',
      Icon: ListOrdered,
      action: () => onOpenPage('results'),
    },
    {
      title: 'Add money / Support',
      subtitle: 'WhatsApp support for coin top-up',
      Icon: MessageCircle,
      action: () => void openAddMoneyWhatsApp(),
    },
    {
      title: 'Withdraw money',
      subtitle: 'WhatsApp support for withdrawal',
      Icon: Banknote,
      action: () => void openWithdrawWhatsApp(),
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
            Market results come from the official published source (admin can override). Play Harf uses
            lowest-total digit. Winners receive 8 coins per 1 coin staked.
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
        <LogOut size={16} />
        Logout
      </button>
    </div>
  );
}
