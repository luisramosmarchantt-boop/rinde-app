// Suscripcion del navegador a notificaciones Web Push.
import { supabase } from './supabaseClient.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getVapidPublicKey() {
  const resp = await fetch('/api/vapid-public-key');
  if (!resp.ok) throw new Error('No se pudo obtener la clave VAPID');
  const { publicKey } = await resp.json();
  return publicKey;
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getSubscriptionState() {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'subscribed' : 'not-subscribed';
}

export async function subscribeToPush(userId) {
  if (!isPushSupported()) throw new Error('Este navegador no soporta notificaciones');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permiso de notificaciones denegado');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const publicKey = await getVapidPublicKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return sub;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

// Invoca la Edge Function send-push (requiere ser revisor/admin).
export async function sendPush({ recipientId, title, body, type }) {
  const { data, error } = await supabase.functions.invoke('send-push', {
    body: { recipient_id: recipientId, title, body, type }
  });
  if (error) throw error;
  return data;
}
