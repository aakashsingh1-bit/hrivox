import { AuthProvider, useAuth } from '@/lib/auth';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { GamesListScreen } from '@/screens/GamesListScreen';
import { PlayScreen } from '@/screens/PlayScreen';
import { AccountScreen } from '@/screens/AccountScreen';
import { AdminScreen } from '@/screens/AdminScreen';
import { MoreScreen } from '@/screens/MoreScreen';
import { AppShell, type Tab } from '@/components/AppShell';
import { useState } from 'react';

function AppContent() {
  const { profile, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [playGameId, setPlayGameId] = useState<string | null>(null);
  const [harfGameId, setHarfGameId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="loading-screen">
        <img src="/logo.png" alt="HRIVOX 900" className="loading-logo" />
        <div className="loading-spinner" />
        <p style={{ margin: 0, fontWeight: 600 }}>Loading HRIVOX 900...</p>
      </div>
    );
  }

  if (!profile) return <AuthScreen />;

  if (activeTab === 'admin' && profile.is_admin) {
    return <AdminScreen onBack={() => setActiveTab('more')} />;
  }

  const onTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setPlayGameId(null);
    setHarfGameId(null);
  };

  const shellTab = activeTab === 'admin' ? 'more' : activeTab;

  return (
    <AppShell activeTab={shellTab} onTabChange={onTabChange}>
      {activeTab === 'home' && <HomeScreen onNavigate={onTabChange} />}
      {activeTab === 'play' &&
        (playGameId ? (
          <PlayScreen gameId={playGameId} mode="full" onBack={() => setPlayGameId(null)} />
        ) : (
          <GamesListScreen mode="full" onOpenGame={setPlayGameId} />
        ))}
      {activeTab === 'half' &&
        (harfGameId ? (
          <PlayScreen gameId={harfGameId} mode="harf" onBack={() => setHarfGameId(null)} />
        ) : (
          <GamesListScreen mode="harf" onOpenGame={setHarfGameId} />
        ))}
      {activeTab === 'account' && <AccountScreen onNavigate={onTabChange} />}
      {activeTab === 'more' && <MoreScreen onNavigate={onTabChange} />}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
