import { AuthProvider, useAuth } from '@/lib/auth';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { PlayScreen } from '@/screens/PlayScreen';
import { AccountScreen } from '@/screens/AccountScreen';
import { AdminScreen } from '@/screens/AdminScreen';
import { MoreScreen } from '@/screens/MoreScreen';
import { AppShell, type Tab } from '@/components/AppShell';
import { useState } from 'react';

function AppContent() {
  const { profile, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('home');

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

  const shellTab = activeTab === 'admin' ? 'more' : activeTab;

  return (
    <AppShell activeTab={shellTab} onTabChange={setActiveTab}>
      {activeTab === 'home' && <HomeScreen onNavigate={setActiveTab} />}
      {activeTab === 'play' && <PlayScreen onBack={() => setActiveTab('home')} />}
      {activeTab === 'half' && <PlayScreen onBack={() => setActiveTab('home')} half />}
      {activeTab === 'account' && <AccountScreen onNavigate={setActiveTab} />}
      {activeTab === 'more' && <MoreScreen onNavigate={setActiveTab} />}
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
