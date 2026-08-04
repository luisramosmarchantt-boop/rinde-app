// Autenticacion por RUT + contraseña. Supabase Auth exige un email interno;
// se genera uno sintetico y oculto a partir del RUT, que el usuario nunca ve.
import { supabase } from './supabaseClient.js';

// Deja solo digitos y el digito verificador (k/K), sin puntos ni guion.
export function normalizeRut(rut) {
  return String(rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
}

// Formato legible para mostrar: 12.345.678-9
export function formatRut(rut) {
  const n = normalizeRut(rut);
  if (n.length < 2) return n;
  const body = n.slice(0, -1);
  const dv = n.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

function syntheticEmail(rut) {
  return `${normalizeRut(rut)}@rindeapp-cloud.netlify.app`;
}

export async function signUp({ rut, fullName, password }) {
  const email = syntheticEmail(rut);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { rut: normalizeRut(rut), full_name: (fullName || '').trim() } }
  });
  if (error) throw error;
  return data;
}

export async function signIn({ rut, password }) {
  const email = syntheticEmail(rut);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Perfil (rol, nombre) del usuario actualmente logueado.
export async function getMyProfile() {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).single();
  if (error) throw error;
  return data;
}

export function onAuthStateChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}
