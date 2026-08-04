// Devuelve la clave publica VAPID (no es secreta) para que el navegador pueda
// suscribirse a Web Push. La clave privada nunca sale de Supabase.
exports.handler = async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  if (!publicKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta VAPID_PUBLIC_KEY' }) };
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey })
  };
};
