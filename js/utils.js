// Utilidades generales

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const CURRENCIES = {
  CLP: { symbol: '$', name: 'Peso chileno', decimals: 0 },
  USD: { symbol: 'US$', name: 'Dolar', decimals: 2 },
  EUR: { symbol: 'EUR', name: 'Euro', decimals: 2 },
  MXN: { symbol: '$', name: 'Peso mexicano', decimals: 2 },
  ARS: { symbol: '$', name: 'Peso argentino', decimals: 2 },
  COP: { symbol: '$', name: 'Peso colombiano', decimals: 0 },
  PEN: { symbol: 'S/', name: 'Sol', decimals: 2 },
  BRL: { symbol: 'R$', name: 'Real', decimals: 2 },
  UYU: { symbol: '$U', name: 'Peso uruguayo', decimals: 2 }
};

export function formatMoney(amount, currency = 'CLP', withSymbol = true) {
  const c = CURRENCIES[currency] || CURRENCIES.CLP;
  const n = Number(amount) || 0;
  const formatted = n.toLocaleString('es-CL', {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals
  });
  return withSymbol ? `${c.symbol} ${formatted}` : formatted;
}

export function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function parseDate(iso) {
  const [y, m, d] = (iso || todayISO()).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

export function formatDate(iso) {
  const d = parseDate(iso);
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateLong(iso) {
  const d = parseDate(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES_L[d.getMonth()]}, ${d.getFullYear()}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES_L[m - 1]} ${y}`;
}

export function monthKey(iso) {
  return (iso || todayISO()).slice(0, 7);
}

export function shortMonth(ym) {
  const [, m] = ym.split('-').map(Number);
  return MESES[m - 1];
}

export function relativeDay(iso) {
  const d = parseDate(iso);
  const today = parseDate(todayISO());
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff > 1 && diff < 7) return DIAS[d.getDay()];
  return formatDate(iso);
}


export const PAYMENT_METHODS = [
  { id: 'efectivo', label: 'Efectivo', emoji: '💵' },
  { id: 'tarjeta_credito', label: 'Tarjeta de credito', emoji: '💳' },
  { id: 'tarjeta_debito', label: 'Tarjeta de debito', emoji: '🏧' },
  { id: 'transferencia', label: 'Transferencia', emoji: '🏦' },
  { id: 'tarjeta_empresa', label: 'Tarjeta empresa', emoji: '🏢' },
  { id: 'otro', label: 'Otro', emoji: '🔁' }
];

export function paymentLabel(id) {
  const p = PAYMENT_METHODS.find((m) => m.id === id);
  return p ? `${p.emoji} ${p.label}` : '-';
}

export function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toast(msg, type = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CHART_COLORS = [
  '#0d6efd', '#1aa251', '#c97a04', '#d63b3b', '#6b46c1',
  '#0aa2c0', '#e8590c', '#d6336c', '#2b8a3e', '#5c7cfa'
];
