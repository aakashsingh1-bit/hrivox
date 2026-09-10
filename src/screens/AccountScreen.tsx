import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, openAddMoneyWhatsApp, type Bet, type Game } from '@/lib/supabase';
import { ChevronRight, Coins, ListOrdered, CircleHelp, Settings, ShieldCheck, MessageCircle } from 'lucide-react';
import type { Tab } from '@/components/AppShell';

export function AccountScreen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { profile, signOut, refreshProfile } = useAuth();
  const [bets, setBets] = useState<Bet[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [toast, setToast] = useState('');

  useEffect(() => {
    loadBets();
    loadGames();
    refreshProfile();
  }, []);

  const loadBets = async () => {
    if (!profile) return;
    const { data } = await supabase.from('bets').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(30);
    if (data) setBets(data as Bet[]);
  };

  const loadGames = async () => {
    const { data } = await supabase.from('games').select('*');
    if (data) setGames(data as Game[]);
  };

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  };

  const gameName = (id: string) => games.find((g) => g.id === id)?.name ?? 'Unknown';

  return (
    <div className="account-screen page-screen">
      <div className="account-heading">
        <span className="profile-avatar">{profile?.display_name?.[0]?.toUpperCase() ?? 'P'}</span>
        <div>
          <span className="small-label">MY ACCOUNT</span>
          <h1>{profile?.display_name ?? 'Player'}</h1>
          <p>{profile?.phone || 'Phone not set'}</p>
        </div>
        <button type="button" className="icon-button" onClick={() => notify('Contact support for account help')}>
          <Settings size={18} />
        </button>
      </div>

      <div className="balance-card">
        <span>AVAILABLE COINS</span>
        <strong><Coins size={26} /> {profile?.coins ?? 0}</strong>
        <small>Payout rule: 1 → 8 on win</small>
      </div>

      <button type="button" className="add-money-btn" onClick={() => openAddMoneyWhatsApp()}>
        <MessageCircle size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
        ऐड मनी / Add Money
      </button>

      <div className="account-list">
        <button type="button" onClick={() => onNavigate('play')}>
          <span><ListOrdered size={17} /> Play & participate</span>
          <ChevronRight size={16} />
        </button>
        <button type="button" onClick={() => onNavigate('more')}>
          <span><CircleHelp size={17} /> Help & information</span>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="history-box">
        <div className="section-top">
          <h2>Participation history</h2>
          <span className="small-label">LATEST</span>
        </div>
        {bets.length === 0 ? (
          <p className="empty-state">No bets yet. Open Games to place your first entry.</p>
        ) : (
          bets.map((bet) => (
            <div key={bet.id} className="history-row">
              <span className={`history-badge ${bet.status === 'won' ? 'green' : bet.status === 'lost' ? 'red' : 'blue'}`}>
                {bet.selected_number}
              </span>
              <div>
                <strong>{gameName(bet.game_id)} — #{bet.selected_number}</strong>
                <small>
                  {bet.amount} coins · {bet.status} · {new Date(bet.created_at).toLocaleString()}
                </small>
              </div>
              <b className={bet.status === 'won' ? 'text-green' : bet.status === 'lost' ? 'text-red' : ''}>
                {bet.status === 'won' ? `+${bet.payout}` : bet.status === 'lost' ? `-${bet.amount}` : 'Pending'}
              </b>
            </div>
          ))
        )}
      </div>

      <button type="button" className="logout-button" onClick={async () => { await signOut(); }}>
        Logout
      </button>

      {toast && <div className="toast"><ShieldCheck size={16} /> {toast}</div>}
    </div>
  );
}
