import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  supabase,
  openAddMoneyWhatsApp,
  formatCountdown,
  isHarfGame,
  type Game,
  type Bet,
} from '@/lib/supabase';
import { Coins, ChevronRight, MessageCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Tab } from '@/components/AppShell';

const TILE_COLORS = ['purple', 'pink', 'cyan', 'green', 'orange'];

function sortHomeGames(list: Game[]) {
  return [...list].sort((a, b) => {
    if (isHarfGame(a) && !isHarfGame(b)) return -1;
    if (!isHarfGame(a) && isHarfGame(b)) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function HomeScreen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { profile, refreshProfile } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState(0);
  const [recentBets, setRecentBets] = useState<Bet[]>([]);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    loadGames();
    loadRecentBets();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    const settle = window.setInterval(() => {
      supabase.rpc('try_settle_due').then(() => loadGames());
    }, 30000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(settle);
    };
  }, []);

  useEffect(() => {
    if (profile) loadRecentBets();
  }, [profile?.id]);

  const loadGames = async () => {
    try {
      await supabase.rpc('try_settle_due');
    } catch {
      /* ignore if RPC not ready */
    }
    const { data } = await supabase.from('games').select('*').order('created_at');
    if (data) setGames(sortHomeGames(data as Game[]));
  };

  const loadRecentBets = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('bets')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (data) setRecentBets(data as Bet[]);
  };

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  };

  const game = games[selectedGame];
  const nextMs = game?.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
  const timeLabel = game?.result_published_at
    ? new Date(game.result_published_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : game?.next_result_at
      ? new Date(game.next_result_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : game?.schedule_time;

  const userLabel = profile?.display_name ?? 'Player';
  const userCode = profile?.id ? profile.id.replace(/-/g, '').slice(0, 8) : '';

  return (
    <>
      <section className="home-top">
        <div className="home-top-row">
          <div className="home-user">
            <strong>
              {userLabel}
              {userCode ? ` (${userLabel}${userCode})` : ''}
            </strong>
            <span>{profile?.phone || 'Phone not set'}</span>
          </div>
          <div className="home-coins">
            <Coins size={18} />
            <b>{profile?.coins ?? 0}</b>
          </div>
        </div>
        <p className="home-notice">
          जरूरी सूचना: आपको किसी भी गेम से सम्बंधित फर्जी मैसेज मिलते हैं तो ध्यान दें। HRIVOX 900 आपकी सेवा में उपस्थित है धन्यवाद।
        </p>

        {game && (
          <div className="result-focus">
            <div className="result-time">{timeLabel}</div>
            <div className="result-divider" />
            <div className="result-name">
              <i /> {isHarfGame(game) ? 'HARF' : game.short_code || game.name}
            </div>
            <strong>{game.result || '--'}</strong>
            <small className="result-sub">
              {isHarfGame(game) ? 'Play Harf' : game.name} · Next {formatCountdown(nextMs)}
            </small>
          </div>
        )}
      </section>

      <button type="button" className="ad-money" onClick={() => openAddMoneyWhatsApp()}>
        👉 ऐड मनी करने यहाँ क्लिक करें
      </button>

      <section className="games-section">
        <div className="game-scroller">
          {games.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`game-tile ${TILE_COLORS[index % 5]} ${selectedGame === index ? 'selected' : ''}`}
              onClick={() => {
                setSelectedGame(index);
                onNavigate(isHarfGame(item) ? 'half' : 'play');
              }}
            >
              <strong>{item.result || '--'}</strong>
              <span>{isHarfGame(item) ? 'Play Harf' : item.name}</span>
              <small>
                {item.next_result_at
                  ? new Date(item.next_result_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : item.schedule_time}
              </small>
            </button>
          ))}
        </div>
      </section>

      <div className="home-actions">
        <button
          type="button"
          className="refresh-large"
          onClick={async () => {
            await loadGames();
            await refreshProfile();
            await loadRecentBets();
            notify('Results refreshed');
          }}
        >
          <RefreshCw size={16} /> Refresh
        </button>
        <button type="button" className="whatsapp-button" onClick={() => openAddMoneyWhatsApp('Hello HRIVOX 900 support')}>
          <MessageCircle size={24} />
        </button>
      </div>

      <section className="quick-cards">
        <button type="button" onClick={() => onNavigate('account')}>
          <span className="quick-icon gold">
            <Coins size={18} />
          </span>
          <span>
            <strong>My account</strong>
            <small>{profile?.coins ?? 0} coins</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <button type="button" onClick={() => onNavigate('play')}>
          <span className="quick-icon blue">
            <ShieldCheck size={18} />
          </span>
          <span>
            <strong>Play Game</strong>
            <small>Markets · Open / Jantari / Crossing</small>
          </span>
          <ChevronRight size={16} />
        </button>
        <button type="button" onClick={() => onNavigate('half')}>
          <span className="quick-icon gold">
            <Coins size={18} />
          </span>
          <span>
            <strong>Play Harf</strong>
            <small>Wheel · digits 0–9</small>
          </span>
          <ChevronRight size={16} />
        </button>
      </section>

      {recentBets.length > 0 && (
        <section className="recent-bets-home">
          <h2>Recent activity</h2>
          {recentBets.map((bet) => {
            const gameName = games.find((g) => g.id === bet.game_id)?.name ?? 'Unknown';
            return (
              <div key={bet.id} className="history-row">
                <span className={`history-badge ${bet.status === 'won' ? 'green' : bet.status === 'lost' ? 'red' : 'blue'}`}>
                  {bet.selected_number}
                </span>
                <div>
                  <strong>
                    {gameName} — #{bet.selected_number}
                  </strong>
                  <small>
                    {bet.amount} coins · {bet.status}
                  </small>
                </div>
                <b className={bet.status === 'won' ? 'text-green' : bet.status === 'lost' ? 'text-red' : ''}>
                  {bet.status === 'won' ? `+${bet.payout}` : bet.status === 'lost' ? `-${bet.amount}` : 'Pending'}
                </b>
              </div>
            );
          })}
        </section>
      )}

      {toast && (
        <div className="toast">
          <ShieldCheck size={16} /> {toast}
        </div>
      )}
    </>
  );
}
