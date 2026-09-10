// Supabase Edge Function — settle due games every minute via cron
// Deploy: supabase functions deploy settle-games
// Schedule (Dashboard → Edge Functions → Cron): * * * * * → settle-games
// Or: supabase secrets set + use pg_cron calling settle_due_games()

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Allow service-role invocations without cron secret when using Supabase scheduler
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      if (!authHeader.includes(serviceKey) && authHeader !== `Bearer ${serviceKey}`) {
        // still allow if no CRON_SECRET configured
        if (cronSecret) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin.rpc('settle_due_games');
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ settled: data ?? 0, at: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
