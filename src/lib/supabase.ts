import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');

/** Fallback if DB setting not loaded yet. */
export const SUPPORT_WHATSAPP_DEFAULT = '919999999999';

/** @deprecated Prefer getSupportWhatsApp() — kept for quick display fallback. */
export let SUPPORT_WHATSAPP = SUPPORT_WHATSAPP_DEFAULT;

let supportCache: string | null = null;
let supportFetch: Promise<string> | null = null;

/** Digits-only WhatsApp number with country code (from Admin Settings). */
export async function getSupportWhatsApp(): Promise<string> {
  if (supportCache) return supportCache;
  if (!supportFetch) {
    supportFetch = (async () => {
      try {
        const { data, error } = await supabase.rpc('get_support_whatsapp');
        if (!error && typeof data === 'string' && data.trim()) {
          supportCache = data.replace(/\D/g, '');
          SUPPORT_WHATSAPP = supportCache;
          return supportCache;
        }
        const { data: row } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'support_whatsapp')
          .maybeSingle();
        if (row?.value) {
          supportCache = String(row.value).replace(/\D/g, '');
          SUPPORT_WHATSAPP = supportCache;
          return supportCache;
        }
      } catch {
        /* ignore */
      }
      return SUPPORT_WHATSAPP_DEFAULT;
    })().finally(() => {
      supportFetch = null;
    });
  }
  return supportFetch;
}

export function clearSupportWhatsAppCache() {
  supportCache = null;
}

/** Standalone Play Harf game short_code (separate from market games). */
export const HARF_SHORT_CODE = 'HF';

export type Profile = {
  id: string;
  display_name: string;
  phone: string;
  coins: number;
  is_admin: boolean;
  referral_code?: string | null;
  referred_by?: string | null;
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
  external_name?: string | null;
  last_scraped_result?: string | null;
  last_scraped_at?: string | null;
  /** Win payout: stake × this (Harf default 8, markets default 90). */
  payout_multiplier?: number | null;
  /** Admin override: last time users can bet. Null = scrap/schedule default. */
  betting_closes_at?: string | null;
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
  bet_kind?: string | null;
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

export async function openAddMoneyWhatsApp(message?: string) {
  const num = await getSupportWhatsApp();
  const text = encodeURIComponent(message || 'Hello HRIVOX 900, I want to add coins to my account.');
  const url = `https://wa.me/${num}?text=${text}`;
  window.open(url, '_blank');
}

export async function openWithdrawWhatsApp() {
  return openAddMoneyWhatsApp(
    'Hello HRIVOX 900, I want to withdraw money from my account.',
  );
}
