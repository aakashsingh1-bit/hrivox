import { AuthProvider, useAuth } from '@/lib/auth';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { GamesListScreen } from '@/screens/GamesListScreen';
import { PlayScreen } from '@/screens/PlayScreen';
import { MarketPlayScreen } from '@/screens/MarketPlayScreen';
import { AccountScreen } from '@/screens/AccountScreen';
import { AdminScreen } from '@/screens/AdminScreen';
import { MoreScreen, type MorePage } from '@/screens/MoreScreen';
import { HowItWorksScreen } from '@/screens/HowItWorksScreen';
import { TimingsScreen } from '@/screens/TimingsScreen';
import { ResultsHistoryScreen } from '@/screens/ResultsHistoryScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SplashScreen } from '@/screens/SplashScreen';
import { AppShell, type Tab } from '@/components/AppShell';
import { shouldShowSplash } from '@/lib/prefs';
import { playNav } from '@/lib/sounds';
import { useCallback, useState } from 'react';

function AppContent() {
  const { profile, loading } = useAuth();
  const [splashDone, setSplashDone] = useState(!shouldShowSplash());
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [playGameId, setPlayGameId] = useState<string | null>(null);
  const [harfGameId, setHarfGameId] = useState<string | null>(null);
  const [morePage, setMorePage] = useState<MorePage>('menu');

  const finishSplash = useCallback(() => setSplashDone(true), []);

  if (!splashDone) {
    return <SplashScreen onDone={finishSplash} />;
  }

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
    return (
      <div className="prototype-app admin-frame">
        <AdminScreen onBack={() => setActiveTab('more')} />
      </div>
    );
  }

  const onTabChange = (tab: Tab) => {
    playNav();
    setActiveTab(tab);
    setPlayGameId(null);
    setHarfGameId(null);
    setMorePage('menu');
  };

  const shellTab = activeTab === 'admin' ? 'more' : activeTab;
  const hideNav = Boolean(activeTab === 'play' && playGameId) || Boolean(activeTab === 'half' && harfGameId);

  return (
    <AppShell activeTab={shellTab} onTabChange={onTabChange} hideNav={hideNav}>
      {activeTab === 'home' && <HomeScreen onNavigate={onTabChange} />}
      {activeTab === 'play' &&
        (playGameId ? (
          <MarketPlayScreen gameId={playGameId} onBack={() => setPlayGameId(null)} />
        ) : (
          <GamesListScreen mode="full" onOpenGame={setPlayGameId} />
        ))}
      {activeTab === 'half' &&
        (harfGameId ? (
          <PlayScreen gameId={harfGameId} mode="harf" onBack={() => setHarfGameId(null)} />
        ) : (
          <GamesListScreen mode="harf" onOpenGame={setHarfGameId} />
        ))}
      {activeTab === 'account' && (
        <AccountScreen onNavigate={onTabChange} onOpenSettings={() => {
          setActiveTab('more');
          setMorePage('settings');
        }} />
      )}
      {activeTab === 'more' && morePage === 'menu' && (
        <MoreScreen onNavigate={onTabChange} onOpenPage={setMorePage} />
      )}
      {activeTab === 'more' && morePage === 'how' && <HowItWorksScreen onBack={() => setMorePage('menu')} />}
      {activeTab === 'more' && morePage === 'timings' && <TimingsScreen onBack={() => setMorePage('menu')} />}
      {activeTab === 'more' && morePage === 'results' && (
        <ResultsHistoryScreen onBack={() => setMorePage('menu')} />
      )}
      {activeTab === 'more' && morePage === 'settings' && (
        <SettingsScreen onBack={() => setMorePage('menu')} />
      )}
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
