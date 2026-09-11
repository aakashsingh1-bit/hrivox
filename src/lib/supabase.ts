import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');

/** WhatsApp support number (digits only, with country code). Update for client. */
export const SUPPORT_WHATSAPP = '919999999999';

/** Standalone Play Harf game short_code (separate from market games). */
export const HARF_SHORT_CODE = 'HF';

export type Profile = {
  id: string;
  display_name: string;
  phone: string;
  coins: number;
  is_admin: boolean;
  created_at: string;
};

export type Game = {
  id: string;
  name: string;
  short_code: string;
  schedule_time: string;
  result: string;
  is_active: boolean;
  result_published_at: string | null;
  next_result_at: string | null;
  created_at: string;
};

export function isHarfGame(game: Pick<Game, 'short_code'> | null | undefined) {
  return game?.short_code === HARF_SHORT_CODE;
}

export type Bet = {
  id: string;
  user_id: string;
  game_id: string;
  selected_number: number;
  amount: number;
  status: string;
  payout: number;
  created_at: string;
};

export type ResultHistory = {
  id: string;
  game_id: string;
  result: string;
  published_at: string;
};

export function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function openAddMoneyWhatsApp(message?: string) {
  const text = encodeURIComponent(message || 'Hello HRIVOX 900, I want to add coins to my account.');
  window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`, '_blank');
}
