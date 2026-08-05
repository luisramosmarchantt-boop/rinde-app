// Edge Function: send-push
// Envia una notificacion Web Push a uno o varios trabajadores. Acepta
// recipient_id (un id, o 'all' para todos) o recipient_ids (lista de ids).
// Solo revisor/admin pueden invocarla (se valida el rol del que llama con
// su propio JWT). Usa service_role internamente para leer las
// suscripciones sin pasar por RLS, y deja registro en notifications_log.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// El navegador manda un preflight OPTIONS (por el header Authorization
// custom) antes del POST real; sin estos headers Supabase lo rechaza y el
// POST nunca se llega a enviar.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendToSubs(adminClient: ReturnType<typeof createClient>, subs: Sub[], title: string, body: string) {
  let sent = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body: body || '', url: './' })
      );
      sent++;
    } catch (e) {
      errors.push(String((e as Error).message || e));
      // Suscripcion vencida/invalida: la limpiamos.
      if ((e as { statusCode?: number }).statusCode === 410 || (e as { statusCode?: number }).statusCode === 404) {
        await adminClient.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
  return { sent, errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Metodo no permitido' });

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader) return json(401, { error: 'Falta autenticacion' });

  let payload: { recipient_id?: string; recipient_ids?: string[]; title?: string; body?: string; type?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'JSON invalido' }); }
  const { recipient_id, recipient_ids, title, body, type } = payload;
  if (!title) return json(400, { error: 'Falta title' });
  if (!recipient_id && !(Array.isArray(recipient_ids) && recipient_ids.length)) {
    return json(400, { error: 'Falta recipient_id o recipient_ids' });
  }

  // Cliente con el JWT de quien llama, para validar su rol via RLS/helper.
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: 'Sesion invalida' });

  const { data: callerProfile, error: profileErr } = await callerClient
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (profileErr || !callerProfile || !['reviewer', 'admin'].includes(callerProfile.role)) {
    return json(403, { error: 'Solo revisoras o admin pueden enviar notificaciones' });
  }

  // Cliente con service_role para leer suscripciones y escribir el log sin RLS.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resuelve la lista final de destinatarios: ids explicitos, o todos los trabajadores.
  let targets: string[];
  let totalWorkers: number | null = null;
  if (Array.isArray(recipient_ids) && recipient_ids.length) {
    targets = recipient_ids;
  } else if (recipient_id === 'all') {
    const { data: workers, error: workersErr } = await adminClient
      .from('profiles').select('id').eq('role', 'worker');
    if (workersErr) return json(500, { error: 'No se pudo leer trabajadores', detail: workersErr.message });
    targets = (workers || []).map((w) => w.id as string);
    totalWorkers = targets.length;
  } else {
    targets = [recipient_id as string];
  }

  let totalSent = 0;
  let notified = 0;
  const errors: string[] = [];
  for (const targetId of targets) {
    const { data: subs, error: subsErr } = await adminClient
      .from('push_subscriptions').select('*').eq('user_id', targetId);
    if (subsErr) { errors.push(subsErr.message); continue; }
    const { sent, errors: sendErrors } = await sendToSubs(adminClient, (subs || []) as Sub[], title, body || '');
    if (sent > 0) notified++;
    totalSent += sent;
    errors.push(...sendErrors);
    await adminClient.from('notifications_log').insert({
      recipient_id: targetId,
      type: type || 'manual_reminder',
      title,
      body: body || '',
      sent_by: userData.user.id
    });
  }

  console.log('send-push result', JSON.stringify({ targets, totalSent, notified, errors }));
  return json(200, { sent: totalSent, workers: totalWorkers ?? targets.length, notified, errors });
});
