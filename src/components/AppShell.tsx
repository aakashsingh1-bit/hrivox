import type { ReactNode } from 'react';
import { Gamepad2, Home as HomeIcon, Menu, WalletCards } from 'lucide-react';

export type Tab = 'home' | 'play' | 'half' | 'account' | 'more' | 'admin';

const navItems: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'play', label: 'Play Game' },
  { id: 'half', label: 'Play Harf' },
  { id: 'account', label: 'Account' },
  { id: 'more', label: 'More' },
];

export function AppShell({ activeTab, onTabChange, children }: { activeTab: Tab; onTabChange: (tab: Tab) => void; children: ReactNode }) {
  return (
    <div className="prototype-app">
      <main className="app-content">{children}</main>
      <nav className="bottom-nav">
        {navItems.map((item) => (
          <button key={item.id} type="button" className={activeTab === item.id ? 'active' : ''} onClick={() => onTabChange(item.id)}>
            {item.id === 'home' && <HomeIcon size={22} />}
            {item.id === 'play' && <Gamepad2 size={22} />}
            {item.id === 'half' && <span className="half-icon">H</span>}
            {item.id === 'account' && <WalletCards size={22} />}
            {item.id === 'more' && <Menu size={22} />}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
