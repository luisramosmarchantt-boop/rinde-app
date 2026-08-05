// ===== Capa de datos: Supabase (Postgres + Realtime) en vez de localStorage =====
// Mantiene una cache en memoria hidratada al login y parcheada en vivo por
// Realtime, con el mismo patron pub/sub (subscribe/notify) que ya usaba la
// version local, para que las vistas casi no cambien.
import { supabase } from './supabaseClient.js';
import { uploadReceipt, deleteReceiptFile } from './storage.js';
import { todayISO, monthKey } from './utils.js';

let data = {
  profile: null,
  myRole: 'worker',
  profiles: [],
  categories: [],
  bts: [],
  transfers: [],
  reports: [],
  expenses: [],
  comments: [],
  approvalRequests: [],
  myNotifications: []
};
let currentUserId = null;
let channels = [];

// --- suscriptores (re-render), igual patron que la version local ---
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { subs.forEach((fn) => fn()); }

// ===== Mapeo DB (snake_case) <-> JS (camelCase) =====
function mapProfile(row) {
  return { id: row.id, rut: row.rut, fullName: row.full_name, company: row.company, role: row.role, cargo: row.cargo, createdAt: new Date(row.created_at).getTime() };
}
function mapBt(row) {
  return { id: row.id, code: row.code, name: row.name, createdBy: row.created_by, createdAt: new Date(row.created_at).getTime() };
}
function mapTransfer(row) {
  return { id: row.id, ownerId: row.owner_id, createdBy: row.created_by, amount: Number(row.amount), currency: row.currency, date: row.date, note: row.note, createdAt: new Date(row.created_at).getTime() };
}
function mapReport(row) {
  return {
    id: row.id, ownerId: row.owner_id, title: row.title, description: row.description,
    period: row.period, obra: row.obra, montoAsignado: Number(row.monto_asignado),
    saldoInicial: row.saldo_inicial != null ? Number(row.saldo_inicial) : null,
    rendNumber: row.rend_number, otNumber: row.ot_number, traspaso: row.traspaso,
    observaciones: row.observaciones, status: row.status, reviewerId: row.reviewer_id,
    reviewedAt: row.reviewed_at, createdAt: new Date(row.created_at).getTime()
  };
}
function mapExpense(row) {
  return {
    id: row.id, ownerId: row.owner_id, amount: Number(row.amount), currency: row.currency,
    categoryId: row.category_id, date: row.date, merchant: row.merchant, docType: row.doc_type,
    docNumber: row.doc_number, paymentMethod: row.payment_method, notes: row.notes,
    reportId: row.report_id, btId: row.bt_id, taxIncluded: row.tax_included, billable: row.billable,
    reviewStatus: row.review_status, approvedAmount: row.approved_amount != null ? Number(row.approved_amount) : null,
    reviewerId: row.reviewer_id, reviewerComment: row.reviewer_comment, reviewedAt: row.reviewed_at,
    createdAt: new Date(row.created_at).getTime(),
    receipts: [] // se completa aparte (join con expense_receipts) al hidratar
  };
}
function mapComment(row) {
  return { id: row.id, targetType: row.target_type, targetId: row.target_id, authorId: row.author_id, body: row.body, createdAt: new Date(row.created_at).getTime() };
}
function mapApprovalRequest(row) {
  return {
    id: row.id, expenseId: row.expense_id, requestedBy: row.requested_by, requestedTo: row.requested_to,
    status: row.status, note: row.note, resolutionNote: row.resolution_note,
    createdAt: new Date(row.created_at).getTime(), resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null
  };
}
function mapNotification(row) {
  return {
    id: row.id, recipientId: row.recipient_id, type: row.type, title: row.title, body: row.body,
    sentBy: row.sent_by, createdAt: new Date(row.created_at).getTime()
  };
}

// Monto que cuenta para saldos/reportes: el ajustado por la revisora si existe.
export const finalAmount = (e) => (e.approvedAmount != null ? e.approvedAmount : e.amount);

// ===== Hidratacion inicial + Realtime =====
export async function hydrate() {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('No hay sesion activa');
  currentUserId = uid;

  const [profs, cats, btsRows, trs, reps, exps, rcpts, apprs, notifs] = await Promise.all([
    supabase.from('profiles').select('*'),
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('bts').select('*'),
    supabase.from('transfers').select('*'),
    supabase.from('reports').select('*'),
    supabase.from('expenses').select('*'),
    supabase.from('expense_receipts').select('*'),
    supabase.from('approval_requests').select('*'),
    supabase.from('notifications_log').select('*').eq('recipient_id', uid).order('created_at', { ascending: false }).limit(50)
  ]);
  for (const r of [profs, cats, btsRows, trs, reps, exps, rcpts, apprs, notifs]) {
    if (r.error) throw r.error;
  }

  data.profiles = (profs.data || []).map(mapProfile);
  data.profile = data.profiles.find((p) => p.id === uid) || null;
  data.myRole = data.profile?.role || 'worker';
  data.categories = (cats.data || []).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, col: c.col }));
  data.bts = (btsRows.data || []).map(mapBt);
  data.transfers = (trs.data || []).map(mapTransfer);
  data.reports = (reps.data || []).map(mapReport);
  data.expenses = (exps.data || []).map(mapExpense);
  data.approvalRequests = (apprs.data || []).map(mapApprovalRequest);
  data.myNotifications = (notifs.data || []).map(mapNotification);

  const byExpense = {};
  (rcpts.data || []).forEach((r) => { (byExpense[r.expense_id] = byExpense[r.expense_id] || []).push({ id: r.id, path: r.storage_path }); });
  data.expenses.forEach((e) => { e.receipts = byExpense[e.id] || []; });

  subscribeRealtime();
  notify();
}

function patchArray(arr, mapFn, payload) {
  if (payload.eventType === 'INSERT') {
    if (!arr.some((x) => x.id === payload.new.id)) arr.push(mapFn(payload.new));
  } else if (payload.eventType === 'UPDATE') {
    const idx = arr.findIndex((x) => x.id === payload.new.id);
    const mapped = mapFn(payload.new);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...mapped }; else arr.push(mapped);
  } else if (payload.eventType === 'DELETE') {
    const idx = arr.findIndex((x) => x.id === payload.old.id);
    if (idx >= 0) arr.splice(idx, 1);
  }
}

function subscribeRealtime() {
  teardownRealtime();
  channels.push(
    supabase.channel('expenses-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, (p) => { patchArray(data.expenses, mapExpense, p); notify(); })
      .subscribe(),
    supabase.channel('reports-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, (p) => { patchArray(data.reports, mapReport, p); notify(); })
      .subscribe(),
    supabase.channel('transfers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, (p) => { patchArray(data.transfers, mapTransfer, p); notify(); })
      .subscribe(),
    supabase.channel('comments-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, (p) => { patchArray(data.comments, mapComment, p); notify(); })
      .subscribe(),
    supabase.channel('bts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bts' }, (p) => { patchArray(data.bts, mapBt, p); notify(); })
      .subscribe(),
    supabase.channel('approval-requests-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, (p) => { patchArray(data.approvalRequests, mapApprovalRequest, p); notify(); })
      .subscribe(),
    // Notificaciones: revisora/admin ven todas por RLS, pero el panel
    // personal solo debe mostrar las propias, asi que se filtra aca.
    supabase.channel('notifications-log-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications_log' }, (p) => {
        const row = p.new || p.old;
        if (row && row.recipient_id === currentUserId) { patchArray(data.myNotifications, mapNotification, p); notify(); }
      })
      .subscribe()
  );
}

export function teardownRealtime() {
  channels.forEach((ch) => supabase.removeChannel(ch));
  channels = [];
}

// ===== Getters =====
export const getProfile = () => data.profile;
export const myUserId = () => currentUserId;
export const myRole = () => data.myRole;
export const isReviewerOrAdmin = () => data.myRole === 'reviewer' || data.myRole === 'admin';
export const isAdmin = () => data.myRole === 'admin';
export const getAllProfiles = () => data.profiles.slice();
export const getProfileById = (id) => data.profiles.find((p) => p.id === id) || null;

export const getCategories = () => data.categories;
export const getCategory = (id) => data.categories.find((c) => c.id === id) || { id: 'otros', name: 'Sin categoria', emoji: '' };

export const getBTs = () => data.bts.slice();
export const getBT = (id) => data.bts.find((b) => b.id === id) || null;
export const btLabel = (id) => { const b = getBT(id); if (!b) return ''; return b.code + (b.name ? '  ' + b.name : ''); };

const sortByDateDesc = (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt;

export const getTransfers = (ownerId = currentUserId) => data.transfers.filter((t) => t.ownerId === ownerId).slice().sort(sortByDateDesc);
export const getExpenses = (ownerId = currentUserId) => data.expenses.filter((e) => e.ownerId === ownerId).slice().sort(sortByDateDesc);
export const getAllExpenses = () => data.expenses.slice().sort(sortByDateDesc);
export const getExpense = (id) => data.expenses.find((e) => e.id === id);

export const getReports = (ownerId = currentUserId) => data.reports.filter((r) => r.ownerId === ownerId).slice().sort((a, b) => b.createdAt - a.createdAt);
export const getAllReports = () => data.reports.slice().sort((a, b) => b.createdAt - a.createdAt);
export const getReport = (id) => data.reports.find((r) => r.id === id);
export const getReportExpenses = (reportId) => data.expenses.filter((e) => e.reportId === reportId);
export const getUnassignedExpenses = (ownerId = currentUserId) => getExpenses(ownerId).filter((e) => !e.reportId);

export const getComments = (targetType, targetId) =>
  data.comments.filter((c) => c.targetType === targetType && c.targetId === targetId).sort((a, b) => a.createdAt - b.createdAt);

// ===== Mutaciones: fondos recibidos (revisora/admin tambien pueden crearlos) =====
export async function addTransfer(ownerId, payload) {
  const { error } = await supabase.from('transfers').insert({
    owner_id: ownerId, created_by: currentUserId,
    amount: Number(payload.amount) || 0, currency: payload.currency || 'CLP',
    date: payload.date || todayISO(), note: payload.note || ''
  });
  if (error) throw error;
  // El evento Realtime (eco de esta misma escritura) actualiza la cache y notifica.
}

export async function updateTransfer(id, patch) {
  const dbPatch = {};
  if ('amount' in patch) dbPatch.amount = Number(patch.amount) || 0;
  if ('date' in patch) dbPatch.date = patch.date;
  if ('note' in patch) dbPatch.note = patch.note;
  const { error } = await supabase.from('transfers').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function deleteTransfer(id) {
  const { error } = await supabase.from('transfers').delete().eq('id', id);
  if (error) throw error;
}

// ===== Mutaciones: gastos =====
export async function addExpense(ownerId, payload) {
  const { data: row, error } = await supabase.from('expenses').insert({
    owner_id: ownerId, amount: Number(payload.amount) || 0, currency: payload.currency || 'CLP',
    category_id: payload.categoryId || 'otros', date: payload.date || todayISO(),
    merchant: payload.merchant || '', doc_type: payload.docType || null,
    doc_number: payload.docNumber || '', payment_method: payload.paymentMethod || 'efectivo',
    notes: payload.notes || '', report_id: payload.reportId || null, bt_id: payload.btId || null,
    tax_included: payload.taxIncluded !== false, billable: payload.billable !== false
  }).select().single();
  if (error) throw error;
  const expenseId = row.id;

  if (Array.isArray(payload.pendingBlobs) && payload.pendingBlobs.length) {
    for (const blob of payload.pendingBlobs) {
      const path = await uploadReceipt(ownerId, expenseId, blob);
      const { error: rcErr } = await supabase.from('expense_receipts').insert({ expense_id: expenseId, storage_path: path });
      if (rcErr) throw rcErr;
    }
  }
  return expenseId;
}

export async function updateExpense(id, patch) {
  const dbPatch = {};
  if ('amount' in patch) dbPatch.amount = Number(patch.amount) || 0;
  if ('currency' in patch) dbPatch.currency = patch.currency;
  if ('categoryId' in patch) dbPatch.category_id = patch.categoryId;
  if ('date' in patch) dbPatch.date = patch.date;
  if ('merchant' in patch) dbPatch.merchant = patch.merchant;
  if ('docType' in patch) dbPatch.doc_type = patch.docType;
  if ('docNumber' in patch) dbPatch.doc_number = patch.docNumber;
  if ('paymentMethod' in patch) dbPatch.payment_method = patch.paymentMethod;
  if ('notes' in patch) dbPatch.notes = patch.notes;
  if ('reportId' in patch) dbPatch.report_id = patch.reportId;
  if ('btId' in patch) dbPatch.bt_id = patch.btId;
  if ('taxIncluded' in patch) dbPatch.tax_included = patch.taxIncluded;
  if ('billable' in patch) dbPatch.billable = patch.billable;
  const { error } = await supabase.from('expenses').update(dbPatch).eq('id', id);
  if (error) throw error;

  if (Array.isArray(patch.newBlobs) && patch.newBlobs.length) {
    const e = getExpense(id);
    for (const blob of patch.newBlobs) {
      const path = await uploadReceipt(e.ownerId, id, blob);
      await supabase.from('expense_receipts').insert({ expense_id: id, storage_path: path });
    }
  }
  if (Array.isArray(patch.removeReceiptIds) && patch.removeReceiptIds.length) {
    const e = getExpense(id);
    for (const rid of patch.removeReceiptIds) {
      const r = (e?.receipts || []).find((x) => x.id === rid);
      if (r) await deleteReceiptFile(r.path);
      await supabase.from('expense_receipts').delete().eq('id', rid);
    }
  }
}

export async function deleteExpense(id) {
  const e = getExpense(id);
  if (e && e.receipts) for (const r of e.receipts) await deleteReceiptFile(r.path);
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
}

// Posible duplicado: mismo N de documento, o mismo monto+fecha, de CUALQUIER
// trabajador (via funcion en el servidor, sin exponer de quien es).
export async function findDuplicate({ amount, date, docNumber }) {
  const { data: rows, error } = await supabase.rpc('find_duplicate_expense', {
    p_doc_number: docNumber || null, p_amount: Number(amount) || 0, p_date: date || null
  });
  if (error) { console.error(error); return null; }
  return rows && rows.length ? rows[0] : null;
}

export async function assignToReport(expenseId, reportId) {
  await updateExpense(expenseId, { reportId });
}

// ===== Revision (revisora/admin): aprobar, ajustar, objetar, pedir aclaracion =====
export async function reviewExpense(expenseId, { status, approvedAmount = null, comment = '' }) {
  const { error } = await supabase.from('expenses').update({
    review_status: status,
    approved_amount: approvedAmount,
    reviewer_id: currentUserId,
    reviewer_comment: comment || null,
    reviewed_at: new Date().toISOString()
  }).eq('id', expenseId);
  if (error) throw error;
  if (comment) await addComment('expense', expenseId, comment);
}

export async function addComment(targetType, targetId, body) {
  const { error } = await supabase.from('comments').insert({ target_type: targetType, target_id: targetId, author_id: currentUserId, body });
  if (error) throw error;
}

// ===== Aprobacion delegada: la revisora envia un gasto a que otra cuenta =====
// (cualquier rol) de el visto bueno final, en vez de aprobarlo ella misma.
export const getApprovalRequests = () => data.approvalRequests.slice();
export const getPendingApprovalsForMe = () =>
  data.approvalRequests.filter((r) => r.requestedTo === currentUserId && r.status === 'pending');
export const getMyNotifications = () => data.myNotifications.slice().sort((a, b) => b.createdAt - a.createdAt);

export async function sendApprovalRequest(expenseId, toUserId, note = '') {
  const { data: row, error } = await supabase.from('approval_requests').insert({
    expense_id: expenseId, requested_by: currentUserId, requested_to: toUserId, note: note || null
  }).select().single();
  if (error) throw error;
  const { error: expErr } = await supabase.from('expenses').update({ review_status: 'sent_for_approval' }).eq('id', expenseId);
  if (expErr) throw expErr;
  return row.id;
}

// Resuelve una solicitud de aprobacion delegada: aprueba (con o sin ajuste
// de monto) o rechaza, y deja el gasto en el mismo estado final que si la
// revisora original lo hubiera resuelto directo.
export async function resolveApprovalRequest(requestId, { approve, approvedAmount = null, resolutionNote = '' }) {
  const { data: reqRow, error: reqErr } = await supabase.from('approval_requests').select('*').eq('id', requestId).single();
  if (reqErr) throw reqErr;
  const newStatus = approve ? (approvedAmount != null ? 'adjusted' : 'approved') : 'objected';
  const { error: expErr } = await supabase.from('expenses').update({
    review_status: newStatus, approved_amount: approvedAmount, reviewer_id: currentUserId,
    reviewer_comment: resolutionNote || null, reviewed_at: new Date().toISOString()
  }).eq('id', reqRow.expense_id);
  if (expErr) throw expErr;
  const { error: rErr } = await supabase.from('approval_requests').update({
    status: approve ? 'approved' : 'rejected', resolution_note: resolutionNote || null, resolved_at: new Date().toISOString()
  }).eq('id', requestId);
  if (rErr) throw rErr;
  if (resolutionNote) await addComment('expense', reqRow.expense_id, resolutionNote);
  return mapApprovalRequest({ ...reqRow, status: approve ? 'approved' : 'rejected' });
}

// Historial de notificaciones enviadas (revisora/admin). Se consulta al
// vuelo, no vive en la cache en memoria porque es solo para mostrar un log.
export async function getRecentNotifications(limit = 30) {
  const { data: rows, error } = await supabase.from('notifications_log')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error(error); return []; }
  return rows.map((r) => ({
    id: r.id, recipientId: r.recipient_id, type: r.type, title: r.title, body: r.body,
    sentBy: r.sent_by, createdAt: new Date(r.created_at).getTime()
  }));
}

// ===== Mutaciones: rendiciones =====
export async function addReport(ownerId, payload) {
  const { data: row, error } = await supabase.from('reports').insert({
    owner_id: ownerId, title: payload.title || 'Rendicion sin titulo', description: payload.description || '',
    period: payload.period || monthKey(todayISO()), obra: payload.obra || '',
    saldo_inicial: (payload.saldoInicial == null || payload.saldoInicial === '') ? null : Number(payload.saldoInicial),
    monto_asignado: Number(payload.montoAsignado) || 0, rend_number: payload.rendNumber || '',
    ot_number: payload.otNumber || '', traspaso: payload.traspaso || '', observaciones: payload.observaciones || ''
  }).select().single();
  if (error) throw error;
  return row.id;
}

export async function updateReport(id, patch) {
  const dbPatch = {};
  if ('title' in patch) dbPatch.title = patch.title;
  if ('description' in patch) dbPatch.description = patch.description;
  if ('period' in patch) dbPatch.period = patch.period;
  if ('obra' in patch) dbPatch.obra = patch.obra;
  if ('saldoInicial' in patch) dbPatch.saldo_inicial = (patch.saldoInicial == null || patch.saldoInicial === '') ? null : Number(patch.saldoInicial);
  if ('montoAsignado' in patch) dbPatch.monto_asignado = Number(patch.montoAsignado) || 0;
  if ('rendNumber' in patch) dbPatch.rend_number = patch.rendNumber;
  if ('otNumber' in patch) dbPatch.ot_number = patch.otNumber;
  if ('traspaso' in patch) dbPatch.traspaso = patch.traspaso;
  if ('observaciones' in patch) dbPatch.observaciones = patch.observaciones;
  if ('status' in patch) dbPatch.status = patch.status;
  const { error } = await supabase.from('reports').update(dbPatch).eq('id', id);
  if (error) throw error;
}

export async function deleteReport(id, { deleteExpenses = false } = {}) {
  const exps = getReportExpenses(id);
  if (deleteExpenses) {
    for (const e of exps) await deleteExpense(e.id);
  } else {
    for (const e of exps) await updateExpense(e.id, { reportId: null });
  }
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) throw error;
}

// ===== BT / Proyectos (solo admin puede escribir, RLS lo exige) =====
export async function addBT({ code, name }) {
  const { data: row, error } = await supabase.from('bts').insert({ code: (code || '').trim(), name: (name || '').trim(), created_by: currentUserId }).select().single();
  if (error) throw error;
  return row.id;
}
export async function updateBT(id, patch) {
  const dbPatch = {};
  if ('code' in patch) dbPatch.code = patch.code;
  if ('name' in patch) dbPatch.name = patch.name;
  const { error } = await supabase.from('bts').update(dbPatch).eq('id', id);
  if (error) throw error;
}
export async function deleteBT(id) {
  const { error } = await supabase.from('bts').delete().eq('id', id);
  if (error) throw error;
}

// ===== Perfil: nombre y cargo editables por el dueño (solo nombre) o por revisora/admin (ambos) =====
export const CARGOS = [
  'Gerente General', 'Representante Legal', 'Socio', 'Jefe de Administracion',
  'Asistente Contable', 'Capataz', 'Ingeniero de Proyectos',
  'Encargado de Prevencion de Riesgos', 'Encargado de Licitaciones',
  'Maestro OOCC', 'Maestro Electrico'
];

export async function updateProfileDetails(userId, { fullName, cargo }) {
  const dbPatch = {};
  if (fullName !== undefined) dbPatch.full_name = fullName;
  if (cargo !== undefined) dbPatch.cargo = cargo || null;
  const { error } = await supabase.from('profiles').update(dbPatch).eq('id', userId);
  if (error) throw error;
  const p = getProfileById(userId);
  if (p) { if (fullName !== undefined) p.fullName = fullName; if (cargo !== undefined) p.cargo = cargo || null; }
  if (data.profile && data.profile.id === userId) {
    if (fullName !== undefined) data.profile.fullName = fullName;
    if (cargo !== undefined) data.profile.cargo = cargo || null;
  }
  notify();
}

// Solo admin: promover a alguien a revisora, o degradarlo.
export async function setRole(userId, role) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
  const p = getProfileById(userId);
  if (p) p.role = role;
  notify();
}

// ===== Agregados / calculos =====
export function totals(ownerId = currentUserId) {
  const exps = getExpenses(ownerId);
  const transfers = getTransfers(ownerId);
  const now = monthKey(todayISO());
  const month = exps.filter((e) => monthKey(e.date) === now);
  const sum = (arr) => arr.reduce((a, e) => a + finalAmount(e), 0);
  const receivedTotal = transfers.reduce((s, t) => s + t.amount, 0);
  const spentTotal = sum(exps);
  return {
    monthTotal: sum(month), monthCount: month.length, receivedTotal, spentTotal,
    availableBalance: receivedTotal - spentTotal,
    unassignedCount: getUnassignedExpenses(ownerId).length,
    allTotal: sum(exps), allCount: exps.length
  };
}

export function byCategory(expenses) {
  const map = new Map();
  expenses.forEach((e) => { map.set(e.categoryId, (map.get(e.categoryId) || 0) + finalAmount(e)); });
  return Array.from(map.entries()).map(([id, total]) => ({ category: getCategory(id), total })).sort((a, b) => b.total - a.total);
}

export function lastMonths(n = 6, ownerId = currentUserId) {
  const result = [];
  const d = new Date(); d.setDate(1);
  const exps = getExpenses(ownerId);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const ym = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`;
    const total = exps.filter((e) => monthKey(e.date) === ym).reduce((a, e) => a + finalAmount(e), 0);
    result.push({ ym, total });
  }
  return result;
}

export function reportTotal(reportId) {
  return getReportExpenses(reportId).reduce((a, e) => a + finalAmount(e), 0);
}

// ===== Saldo corriente (caja chica), por trabajador =====
// Cada rendicion arranca con lo que dejo la anterior; usa el monto AJUSTADO
// por la revisora si existe, asi una objecion sobre una rendicion vieja
// recalcula solo el saldo de las posteriores cada vez que se consulta.
export function reportBalances(ownerId = currentUserId) {
  const received = data.transfers.filter((t) => t.ownerId === ownerId).reduce((s, t) => s + t.amount, 0);
  const chrono = data.reports.filter((r) => r.ownerId === ownerId).slice().sort((a, b) => a.createdAt - b.createdAt);
  let running = received;
  const map = {};
  for (const r of chrono) {
    const total = reportTotal(r.id);
    const manual = r.saldoInicial != null;
    const opening = manual ? r.saldoInicial : running;
    const saldo = opening - total;
    map[r.id] = { opening, total, saldo, manual };
    running = saldo;
  }
  return map;
}

export function reportBalance(id) {
  const r = getReport(id);
  if (!r) return { opening: 0, total: 0, saldo: 0, manual: false };
  return reportBalances(r.ownerId)[id] || { opening: 0, total: reportTotal(id), saldo: -reportTotal(id), manual: false };
}

export function availableForNewReport(ownerId = currentUserId) {
  const received = data.transfers.filter((t) => t.ownerId === ownerId).reduce((s, t) => s + t.amount, 0);
  const chrono = data.reports.filter((r) => r.ownerId === ownerId).slice().sort((a, b) => a.createdAt - b.createdAt);
  if (!chrono.length) return received;
  const balances = reportBalances(ownerId);
  return balances[chrono[chrono.length - 1].id].saldo;
}
