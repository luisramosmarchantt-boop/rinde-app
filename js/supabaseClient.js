// Cliente Supabase compartido por toda la app. URL y clave publicable NO son
// secretos (estan protegidos por RLS en el servidor), por eso se hardcodean
// aca igual que ya se hardcodean otras URLs de CDN en el proyecto.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://rtaftpfqpavmkmgqtdln.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WfYEhRL6UwIKMS7O9cnwPQ_HRBCviTQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
