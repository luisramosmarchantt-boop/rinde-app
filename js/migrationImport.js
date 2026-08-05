// ===== Importar respaldo de "Rendiciones App" (la app anterior, pre-nube) =====
// Herramienta temporal de migracion: cada cuenta puede importar su propio
// respaldo (el JSON que exporta la app vieja desde Ajustes > Respaldo) para
// traer su historial a la nube. Se retira una vez terminada la migracion
// del equipo completo.
import * as store from './store.js';

function b64ToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function parseBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        if (!json || !json.data || !Array.isArray(json.data.expenses)) throw new Error('formato');
        resolve(json);
      } catch (e) { reject(new Error('El archivo no parece un respaldo valido de Rendiciones App.')); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

// Migra el respaldo hacia la cuenta actualmente logueada. onProgress(texto)
// se llama en cada etapa para mostrar avance en pantalla.
export async function runImport(backup, onProgress = () => {}) {
  const ownerId = store.myUserId();
  const d = backup.data || {};
  const receiptsMap = backup.receipts || {};
  const canManageBTs = store.isReviewerOrAdmin();
  const existingCatIds = new Set(store.getCategories().map((c) => c.id));
  const existingBTs = store.getBTs().slice();

  const result = { bts: 0, skippedBts: 0, reports: 0, transfers: 0, expenses: 0, skippedExpenses: 0, errors: [] };
  const byCreatedAtAsc = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

  // 1) BT / Proyectos: matchear por codigo; crear las que falten si el rol lo permite.
  onProgress('Revisando BT / Proyectos...');
  const btIdMap = new Map();
  for (const bt of (d.bts || [])) {
    const match = existingBTs.find((e) => e.code.trim().toLowerCase() === (bt.code || '').trim().toLowerCase());
    if (match) { btIdMap.set(bt.id, match.id); continue; }
    if (!canManageBTs) { result.skippedBts++; continue; }
    try {
      const newId = await store.addBT({ code: bt.code, name: bt.name });
      btIdMap.set(bt.id, newId);
      existingBTs.push({ id: newId, code: bt.code, name: bt.name });
      result.bts++;
    } catch (e) { result.errors.push(`BT ${bt.code}: ${e.message || e}`); }
  }

  // 2) Rendiciones
  const reports = (d.reports || []).slice().sort(byCreatedAtAsc);
  const reportIdMap = new Map();
  let i = 0;
  for (const r of reports) {
    i++;
    onProgress(`Importando rendiciones... (${i}/${reports.length})`);
    try {
      const newId = await store.addReport(ownerId, {
        title: r.title, description: r.description, period: r.period, obra: r.obra,
        saldoInicial: r.saldoInicial, montoAsignado: r.montoAsignado, rendNumber: r.rendNumber,
        otNumber: r.otNumber, traspaso: r.traspaso, observaciones: r.observaciones
      });
      reportIdMap.set(r.id, newId);
      result.reports++;
    } catch (e) { result.errors.push(`Rendicion "${r.title || r.id}": ${e.message || e}`); }
  }

  // 3) Fondos recibidos
  const transfers = (d.transfers || []).slice().sort(byCreatedAtAsc);
  i = 0;
  for (const t of transfers) {
    i++;
    onProgress(`Importando fondos recibidos... (${i}/${transfers.length})`);
    try {
      await store.addTransfer(ownerId, { amount: t.amount, currency: t.currency, date: t.date, note: t.note });
      result.transfers++;
    } catch (e) { result.errors.push(`Fondo del ${t.date}: ${e.message || e}`); }
  }

  // 4) Gastos (con sus boletas). Se salta cualquiera que ya exista (mismo
  // N de documento, o mismo monto+fecha) para poder re-ejecutar sin duplicar.
  const expenses = (d.expenses || []).slice().sort((a, b) => a.date.localeCompare(b.date) || byCreatedAtAsc(a, b));
  i = 0;
  for (const e of expenses) {
    i++;
    onProgress(`Importando gastos... (${i}/${expenses.length})`);
    try {
      const dup = await store.findDuplicate({ amount: e.amount, date: e.date, docNumber: e.docNumber });
      if (dup) { result.skippedExpenses++; continue; }
      const ids = (e.receiptIds && e.receiptIds.length) ? e.receiptIds : (e.receiptId ? [e.receiptId] : []);
      const pendingBlobs = ids.map((rid) => receiptsMap[rid]).filter(Boolean).map(b64ToBlob);
      await store.addExpense(ownerId, {
        amount: e.amount, currency: e.currency,
        categoryId: existingCatIds.has(e.categoryId) ? e.categoryId : 'otros',
        date: e.date, merchant: e.merchant, docType: e.docType, docNumber: e.docNumber,
        paymentMethod: e.paymentMethod, notes: e.notes,
        reportId: e.reportId ? (reportIdMap.get(e.reportId) || null) : null,
        btId: e.btId ? (btIdMap.get(e.btId) || null) : null,
        taxIncluded: e.taxIncluded, billable: e.billable, pendingBlobs
      });
      result.expenses++;
    } catch (err) { result.errors.push(`Gasto ${e.merchant || ''} ${e.date || ''}: ${err.message || err}`); }
  }

  onProgress('Actualizando...');
  await store.hydrate();
  return result;
}
