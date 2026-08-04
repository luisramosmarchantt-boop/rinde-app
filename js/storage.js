// Fotos de boletas: ahora viven en Supabase Storage (bucket privado 'receipts'),
// no en IndexedDB local, para que las revisoras tambien las vean.
import { supabase } from './supabaseClient.js';

// Sube una foto ya comprimida (Blob) para un gasto de un dueño dado.
// Devuelve el storage_path para guardar en expense_receipts.
export async function uploadReceipt(ownerId, expenseId, blob) {
  const ext = (blob.type && blob.type.split('/')[1]) || 'jpg';
  const path = `${ownerId}/${expenseId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('receipts').upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false
  });
  if (error) throw error;
  return path;
}

export async function deleteReceiptFile(path) {
  await supabase.storage.from('receipts').remove([path]);
}

// Descarga el archivo como Blob (para armar el PDF de boletas en el dispositivo).
export async function downloadReceiptBlob(path) {
  const { data, error } = await supabase.storage.from('receipts').download(path);
  if (error) return null;
  return data;
}

// URL firmada temporal para mostrar la foto (bucket privado).
const urlCache = new Map();
export async function getReceiptUrl(path, expiresIn = 3600) {
  if (!path) return null;
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, expiresIn);
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + (expiresIn - 60) * 1000 });
  return data.signedUrl;
}
