// ===== Vistas / pantallas =====
import * as store from './store.js';
import * as storage from './storage.js';
import { donutChart, barList, monthBars } from './charts.js';
import { openSheet, confirmDialog, actionSheet } from './ui.js';
import {
  esc, formatMoney, formatDate, formatDateLong, relativeDay, monthLabel,
  toast, monthKey, downloadFile, CURRENCIES
} from './utils.js';
import { navigate } from './router.js';
import {
  openExpenseForm, openReportForm, openAssignExpenses,
  openProfileForm, openBTForm, openTransferForm, openReviewForm, sendManualReminder,
  openBroadcastForm
} from './forms.js';
import { LOGO_DATAURL } from './assets.js';
import { newDoc, shareFiles, pdfFile } from './pdf.js';

const cur = () => 'CLP';

function safeName(s) { return String(s || 'rendicion').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 40); }

// Carga miniaturas de boletas de forma asincrona (recibe path de Storage)
async function hydrateThumbs(root) {
  for (const el of root.querySelectorAll('[data-receipt]')) {
    const path = el.dataset.receipt;
    if (!path) continue;
    const url = await storage.getReceiptUrl(path);
    if (url) el.outerHTML = `<img class="thumb" src="${url}" alt="boleta"/>`;
  }
}

const REVIEW_BADGE = {
  approved: '✅', adjusted: '✏️', objected: '❌', clarification_requested: '❓'
};

// fila de gasto reutilizable
function expenseItem(e, { showOwner = false } = {}) {
  const c = store.getCategory(e.categoryId);
  const path = e.receipts?.[0]?.path;
  const icon = path
    ? `<span class="emoji" data-receipt="${path}">${c.emoji}</span>`
    : `<span class="emoji">${c.emoji}</span>`;
  const owner = showOwner ? store.getProfileById(e.ownerId) : null;
  const badge = REVIEW_BADGE[e.reviewStatus] || '';
  return `<button class="item" data-action="expense" data-id="${e.id}">
    ${icon}
    <span class="body">
      <span class="t">${esc(e.merchant || c.name)} ${badge}</span>
      <span class="s">${owner ? esc(owner.fullName || owner.rut) + ' - ' : ''}${esc(c.name)}${e.reportId ? '  ' : ''}</span>
    </span>
    <span class="amt mono">${formatMoney(store.finalAmount(e), e.currency)}</span>
  </button>`;
}

// ============ DASHBOARD ============
export function renderDashboard() {
  const t = store.totals();
  const recent = store.getExpenses().slice(0, 4);
  const transfers = store.getTransfers().slice(0, 3);
  const activeReports = store.getReports().slice(0, 3);
  const balanceCls = t.availableBalance < 0 ? 'danger' : 'ok';
  const canManageTransfers = store.isReviewerOrAdmin();

  const html = `
    <div class="balance-card ${balanceCls}">
      <div class="balance-top">
        <span>Saldo disponible</span>
        ${canManageTransfers ? `<button class="mini-link" data-action="transfer">+ transferencia</button>` : ''}
      </div>
      <div class="balance-amount mono">${formatMoney(t.availableBalance, cur())}</div>
      <div class="balance-grid">
        <div><span>Recibido</span><b class="mono">${formatMoney(t.receivedTotal, cur())}</b></div>
        <div><span>Gastado</span><b class="mono">${formatMoney(t.spentTotal, cur())}</b></div>
      </div>
    </div>

    <div class="quick-actions">
      <button class="qa primary" data-action="expense"><b>+ Gasto</b><span>Foto, OCR y datos</span></button>
      <button class="qa" data-action="report"><b>+ Rendicion</b><span>Agrupar gastos</span></button>
    </div>

    ${t.unassignedCount > 0 ? `
    <button class="notice-card" data-action="goexpenses">
      <span><b>${t.unassignedCount}</b> gasto(s) sin rendicion</span>
      <small>Revisar y asignar</small>
    </button>` : ''}

    ${activeReports.length ? `
      <div class="section-title">Rendiciones abiertas</div>
      <div class="list">${activeReports.map(reportItem).join('')}</div>
    ` : ''}

    <div class="row between" style="margin:18px 2px 10px">
      <div class="section-title" style="margin:0">Ultimos gastos</div>
      <a href="#/expenses" class="tiny">Ver todos</a>
    </div>
    <div class="list">
      ${recent.length ? recent.map((e) => expenseItem(e)).join('') : emptyInline('🧾', 'Sin gastos todavia', 'Toca + Gasto para agregar la primera boleta')}
    </div>

    ${transfers.length ? `
      <div class="row between" style="margin:18px 2px 10px">
        <div class="section-title" style="margin:0">Transferencias recibidas</div>
        ${canManageTransfers ? `<button class="mini-link plain" data-action="transfer">Agregar</button>` : ''}
      </div>
      <div class="list simple-list">
        ${transfers.map((tr) => `<${canManageTransfers ? 'button' : 'div'} class="item transfer-item" ${canManageTransfers ? `data-action="edit-transfer" data-id="${tr.id}"` : ''}>
          <span class="emoji">💵</span>
          <span class="body"><span class="t">${esc(tr.note || 'Transferencia')}</span><span class="s">${formatDate(tr.date)}</span></span>
          <span class="amt mono">${formatMoney(tr.amount, tr.currency)}</span>
        </${canManageTransfers ? 'button' : 'div'}>`).join('')}
      </div>
    ` : ''}
  `;
  return { html, mount: (root) => {
    hydrateThumbs(root);
    root.querySelector('[data-action="goexpenses"]')?.addEventListener('click', () => navigate('expenses'));
    root.querySelectorAll('[data-action="transfer"]').forEach((b) => b.addEventListener('click', () => openTransferForm()));
    root.querySelector('[data-action="expense"]')?.addEventListener('click', () => openExpenseForm());
    root.querySelector('[data-action="report"]')?.addEventListener('click', () => openReportForm());
    root.querySelectorAll('[data-action="edit-transfer"]').forEach((b) => b.addEventListener('click', () => openTransferForm(b.dataset.id)));
    wireExpenseItems(root);
    wireReportItems(root);
  }};
}
function emptyInline(emoji, title, sub) {
  return `<div class="empty"><div class="e">${emoji}</div><h3>${title}</h3><p>${sub}</p></div>`;
}

// ============ LISTA DE GASTOS ============
let expFilter = 'all';
let expSearch = '';
const normTxt = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function renderExpenses() {
  const cats = store.getCategories();

  const chips = `
    <div class="chips">
      <button class="chip ${expFilter === 'all' ? 'active' : ''}" data-filter="all">Todos</button>
      <button class="chip ${expFilter === 'month' ? 'active' : ''}" data-filter="month">Este mes</button>
      <button class="chip ${expFilter === 'unassigned' ? 'active' : ''}" data-filter="unassigned">Sin rendicion</button>
      ${cats.map((c) => `<button class="chip ${expFilter === 'cat:' + c.id ? 'active' : ''}" data-filter="cat:${c.id}">${c.emoji} ${esc(c.name.split(' ')[0])}</button>`).join('')}
    </div>`;

  const html = `
    <input class="input" id="expSearch" placeholder="🔍 Buscar comercio, monto o N doc" value="${esc(expSearch)}" style="margin-bottom:8px" />
    ${chips}
    <div id="expListWrap"></div>
  `;
  return { html, mount: (root) => {
    const wrap = root.querySelector('#expListWrap');

    const paint = () => {
      let expenses = store.getExpenses();
      if (expFilter === 'unassigned') expenses = expenses.filter((e) => !e.reportId);
      else if (expFilter === 'month') expenses = expenses.filter((e) => monthKey(e.date) === monthKey(undefined));
      else if (expFilter.startsWith('cat:')) expenses = expenses.filter((e) => e.categoryId === expFilter.slice(4));

      const q = normTxt(expSearch.trim());
      if (q) {
        const qd = q.replace(/[^\d]/g, '');
        expenses = expenses.filter((e) =>
          normTxt(e.merchant).includes(q) || normTxt(e.notes).includes(q) ||
          (qd && (String(e.docNumber || '').includes(qd) || String(Math.round(e.amount || 0)).includes(qd))));
      }

      const total = expenses.reduce((a, e) => a + store.finalAmount(e), 0);
      const groups = {};
      expenses.forEach((e) => { (groups[e.date] = groups[e.date] || []).push(e); });
      const dayBlocks = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map((date) => {
        const items = groups[date];
        const dayTotal = items.reduce((a, e) => a + store.finalAmount(e), 0);
        return `<div class="day-group">
          <div class="day-head"><span>${relativeDay(date)}</span><span class="mono">${formatMoney(dayTotal, cur())}</span></div>
          <div class="list">${items.map((e) => expenseItem(e)).join('')}</div>
        </div>`;
      }).join('');

      wrap.innerHTML = `
        <div class="card row between" style="margin-top:6px">
          <span class="muted">${expenses.length} gasto(s)</span>
          <b class="mono">${formatMoney(total, cur())}</b>
        </div>
        ${expenses.length ? dayBlocks : emptyInline('', q ? 'Sin resultados' : 'No hay gastos', q ? 'Prueba con otra busqueda' : 'Agrega tu primer gasto con el boton +')}
      `;
      hydrateThumbs(wrap);
      wireExpenseItems(wrap);
    };
    paint();

    root.querySelector('#expSearch').addEventListener('input', (ev) => { expSearch = ev.target.value; paint(); });
    root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      expFilter = b.dataset.filter; navigate('expenses');
    }));
  }};
}

// ============ DETALLE DE GASTO (sheet, vista del trabajador) ============
export function openExpenseDetail(id) {
  const e = store.getExpense(id);
  if (!e) { toast('Gasto no encontrado', 'err'); return; }
  const c = store.getCategory(e.categoryId);
  const report = e.reportId ? store.getReport(e.reportId) : null;
  const comments = store.getComments('expense', id);

  const reviewBox = e.reviewStatus && e.reviewStatus !== 'pending' ? `
    <div class="card tight" style="margin-top:10px">
      <b>${REVIEW_BADGE[e.reviewStatus] || ''} ${reviewStatusLabel(e.reviewStatus)}</b>
      ${e.approvedAmount != null ? `<div class="muted tiny">Monto aprobado: ${formatMoney(e.approvedAmount, e.currency)}</div>` : ''}
      ${e.reviewerComment ? `<div class="muted tiny" style="margin-top:4px">"${esc(e.reviewerComment)}"</div>` : ''}
    </div>` : '';

  const html = `
    <div class="sheet-head"><h2>Detalle del gasto</h2><button class="x" data-close></button></div>
    <div class="detail-amount">
      <div class="big mono">${formatMoney(e.amount, e.currency)}</div>
      <div class="cat">${c.emoji} ${esc(c.name)}</div>
    </div>
    ${reviewBox}
    <div class="card">
      <div class="kv"><span class="k">Comercio</span><span class="v">${esc(e.merchant || '')}</span></div>
      <div class="kv"><span class="k">Fecha</span><span class="v">${formatDate(e.date)}</span></div>
      <div class="kv"><span class="k">Documento</span><span class="v">${e.docType ? (e.docType === 'factura' ? 'Factura' : 'Boleta') : ''}${e.docNumber ? ' N ' + esc(e.docNumber) : ''}</span></div>
      <div class="kv"><span class="k">BT / Proyecto</span><span class="v">${e.btId ? esc(store.btLabel(e.btId)) : 'Sin BT'}</span></div>
      <div class="kv"><span class="k">Rendicion</span><span class="v">${report ? esc(report.title) : 'Sin asignar'}</span></div>
    </div>
    ${e.notes ? `<div class="card"><div class="muted tiny" style="margin-bottom:4px">Notas</div>${esc(e.notes)}</div>` : ''}
    ${comments.length ? `<div class="card"><div class="muted tiny" style="margin-bottom:4px">Comentarios</div>${comments.map((c) => `<div class="tiny" style="margin-bottom:4px">${esc(c.body)}</div>`).join('')}</div>` : ''}
    <div id="receiptBox"></div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn outline" data-edit>Editar</button>
      <button class="btn danger" data-del>Eliminar</button>
    </div>
  `;
  openSheet(html, { full: true, onMount: async (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-edit]').onclick = () => { close(); openExpenseForm(e.id); };
    root.querySelector('[data-del]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Eliminar gasto', message: 'Esta accion no se puede deshacer.', confirmText: 'Eliminar', danger: true });
      if (ok) { await store.deleteExpense(e.id); toast('Gasto eliminado'); close(); }
    };
    if (e.receipts?.length) {
      let imgs = '';
      for (const r of e.receipts) {
        const url = await storage.getReceiptUrl(r.path);
        if (url) imgs += `<img class="receipt-img" src="${url}" alt="boleta" style="margin-bottom:8px"/>`;
      }
      if (imgs) root.querySelector('#receiptBox').innerHTML =
        `<div class="section-title">Boleta${e.receipts.length > 1 ? 's (' + e.receipts.length + ')' : ''}</div>${imgs}`;
    }
  }});
}
function reviewStatusLabel(status) {
  return { approved: 'Aprobado', adjusted: 'Ajustado', objected: 'Objetado', clarification_requested: 'Aclaracion solicitada' }[status] || '';
}

// ============ LISTA DE RENDICIONES ============
function reportItem(r) {
  const total = store.reportTotal(r.id);
  const count = store.getReportExpenses(r.id).length;
  return `<button class="item" data-action="report" data-id="${r.id}">
    <span class="emoji">📋</span>
    <span class="body">
      <span class="t">${esc(r.title)}</span>
      <span class="s">${monthLabel(r.period)} - ${count} gasto(s)</span>
    </span>
    <span class="amt mono">${formatMoney(total, cur())}</span>
  </button>`;
}

export function renderReports() {
  const reports = store.getReports();
  const html = `
    <button class="btn primary" data-action="newreport" style="margin-bottom:14px">+ Nueva rendicion</button>
    <div class="list">
      ${reports.length ? reports.map(reportItem).join('') : emptyInline('', 'Sin rendiciones', 'Crea una rendicion para agrupar y rendir tus gastos')}
    </div>
  `;
  return { html, mount: (root) => {
    wireReportItems(root);
    root.querySelector('[data-action="newreport"]')?.addEventListener('click', () => openReportForm());
  }};
}

// ============ DETALLE DE RENDICION (vista del trabajador) ============
export function renderReportDetail(id) {
  const r = store.getReport(id);
  if (!r) return { html: emptyInline('🤔', 'Rendicion no encontrada', ''), mount: () => {} };
  const expenses = store.getReportExpenses(id);
  const total = store.reportTotal(id);
  const byCur = {};
  expenses.forEach((e) => { byCur[e.currency] = (byCur[e.currency] || 0) + store.finalAmount(e); });
  const totalsLine = Object.entries(byCur).map(([c, v]) => formatMoney(v, c)).join(' - ') || formatMoney(0, cur());
  const bal = store.reportBalance(id);

  const html = `
    <div class="card">
      <div class="row between">
        <div></div>
        <button class="btn sm outline no-print" data-act="menu">...</button>
      </div>
      <h2 style="margin:10px 0 2px;font-size:21px">${esc(r.title)}</h2>
      <div class="muted">${r.rendNumber ? 'Rend. N ' + esc(r.rendNumber) + ' - ' : ''}${monthLabel(r.period)}</div>
      ${r.obra ? `<div class="muted tiny" style="margin-top:2px">${esc(r.obra)}</div>` : ''}
      ${r.description ? `<p class="muted" style="margin:8px 0 0">${esc(r.description)}</p>` : ''}
      <hr class="hr"/>
      <div class="row between"><span class="muted">Total rendido</span><b class="mono" style="font-size:20px">${totalsLine}</b></div>
      <div class="row between" style="margin-top:4px"><span class="muted tiny">Monto asignado${bal.manual ? ' (manual)' : ''}</span><span class="mono tiny">${formatMoney(bal.opening, cur())}</span></div>
      <div class="row between"><span class="muted tiny">Saldo</span><span class="mono tiny" style="color:${bal.saldo < 0 ? 'var(--danger)' : 'var(--success)'}">${formatMoney(bal.saldo, cur())}</span></div>
      <div class="muted tiny" style="margin-top:4px">${expenses.length} gasto(s)</div>
    </div>

    <div class="report-actions no-print">
      <button class="btn outline" data-act="assign">Agregar gasto</button>
      <button class="btn outline" data-act="download">Descargar rendicion</button>
      <button class="btn outline" data-act="download-receipts">Descargar boletas</button>
      <button class="btn primary" data-act="send">Enviar por WhatsApp</button>
    </div>

    <div class="row between" style="margin:18px 2px 8px">
      <div class="section-title" style="margin:0">Gastos incluidos</div>
      <button class="btn sm ghost no-print" data-act="export">Mas opciones</button>
    </div>
    <div class="list">
      ${expenses.length ? expenses.map((e) => expenseItem(e)).join('') : emptyInline('🧾', 'Rendicion vacia', 'Agrega gastos a esta rendicion')}
    </div>
  `;

  return { html, mount: (root) => {
    hydrateThumbs(root);
    wireExpenseItems(root);
    root.querySelector('[data-act="assign"]')?.addEventListener('click', () => openExpenseForm(null, id));
    root.querySelector('[data-act="download"]')?.addEventListener('click', () => downloadRendicion(r));
    root.querySelector('[data-act="download-receipts"]')?.addEventListener('click', () => downloadReceipts(r));
    root.querySelector('[data-act="send"]')?.addEventListener('click', () => {
      if (!expenses.length) { toast('Agrega al menos un gasto', 'err'); return; }
      sendViaWhatsapp(r);
    });
    root.querySelector('[data-act="export"]')?.addEventListener('click', () => exportReportMenu(r, expenses, total));
    root.querySelector('[data-act="menu"]')?.addEventListener('click', () => reportMenu(r));
  }};
}
async function reportMenu(r) {
  const idx = await actionSheet(r.title, [
    { label: 'Editar rendicion' },
    { label: 'Agregar gastos ya existentes' },
    { label: 'Exportar / imprimir' },
    { label: 'Eliminar rendicion', danger: true }
  ]);
  if (idx === 0) openReportForm(r.id);
  else if (idx === 1) openAssignExpenses(r.id);
  else if (idx === 2) exportReportMenu(r, store.getReportExpenses(r.id), store.reportTotal(r.id));
  else if (idx === 3) {
    const ok = await confirmDialog({ title: 'Eliminar rendicion', message: 'Los gastos quedaran sin asignar (no se borran). Continuar?', confirmText: 'Eliminar', danger: true });
    if (ok) { await store.deleteReport(r.id); toast('Rendicion eliminada'); navigate('reports'); }
  }
}

async function exportReportMenu(r, expenses, total) {
  const idx = await actionSheet('Exportar rendicion', [
    { label: 'Formulario de rendicion (PDF)' },
    { label: 'Boletas por dia (PDF)' },
    { label: 'Datos en Excel (CSV)' }
  ]);
  if (idx === 0) downloadRendicion(r);
  else if (idx === 1) downloadReceipts(r);
  else if (idx === 2) exportCSV(r, expenses);
}

function exportCSV(r, expenses) {
  const header = ['Fecha', 'Doc', 'N', 'Comercio', 'Categoria', 'BT', 'Descripcion', 'Moneda', 'Monto'];
  const rows = expenses.map((e) => {
    const c = store.getCategory(e.categoryId);
    return [e.date, e.docType === 'factura' ? 'FACT' : 'BOL', e.docNumber || '', e.merchant, c.name,
      store.btLabel(e.btId), (e.notes || e.merchant || '').replace(/\n/g, ' '), e.currency, store.finalAmount(e)];
  });
  const csv = [header, ...rows].map((r) => r.map((cell) =>
    `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  downloadFile(`rendicion-${(r.rendNumber || r.title).replace(/\s+/g, '_')}.csv`, '' + csv, 'text/csv;charset=utf-8');
  toast('CSV descargado', 'ok');
}

function num(n) { return n ? Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 }) : ''; }

// Genera el PDF de la rendicion (formulario tipo Mataquito) como Blob.
async function rendicionPdf(r) {
  const owner = store.getProfileById(r.ownerId) || store.getProfile();
  const expenses = store.getReportExpenses(r.id).slice()
    .sort((a, b) => (String(a.btId || '').localeCompare(String(b.btId || ''))) || a.date.localeCompare(b.date));

  const sub = { aliment: 0, petroleo: 0, peajes: 0, materiales: 0, otros: 0 };
  let total = 0;
  const rows = expenses.map((e) => {
    const c = store.getCategory(e.categoryId);
    const col = c.col || 'otros';
    const amt = store.finalAmount(e);
    sub[col] += amt; total += amt;
    const bt = store.getBT(e.btId);
    const cell = (k) => col === k ? num(amt) : '';
    return [formatDate(e.date), e.docType === 'factura' ? 'FACT' : 'BOL', e.docNumber || '',
      cell('aliment'), cell('petroleo'), cell('peajes'), cell('materiales'), cell('otros'),
      (e.notes || e.merchant || ''), bt ? bt.code : ''];
  });
  const bal = store.reportBalance(r.id);

  const doc = await newDoc('portrait');
  const W = doc.internal.pageSize.getWidth();
  const NAVY = [27, 58, 140];

  doc.setDrawColor(...NAVY); doc.setLineWidth(0.8); doc.line(12, 25, W - 12, 25);
  try { doc.addImage(LOGO_DATAURL, 'PNG', 12, 8, 42, 12); } catch (e) {}
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY);
  doc.text('FORMULARIO RENDICION', W / 2 + 14, 17, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  doc.autoTable({
    startY: 28,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 1.1, lineWidth: 0.1, lineColor: [90, 90, 90] },
    body: [
      ['REND. N', r.rendNumber || '', 'OBRA', r.obra || '', 'MONTO ASIGNADO', num(bal.opening)],
      ['ENCARGADO', owner?.fullName || '', 'RUT', owner?.rut || '', 'PERIODO', monthLabel(r.period)]
    ],
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [238, 242, 251] }, 2: { fontStyle: 'bold', fillColor: [238, 242, 251] }, 4: { fontStyle: 'bold', fillColor: [238, 242, 251] }, 5: { halign: 'right' } }
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 3,
    margin: { left: 12, right: 12 },
    head: [['Fecha', 'Bol/Fact', 'N', 'Aliment.', 'Petroleo', 'Peajes/Est.', 'Materiales', 'Otros', 'Descripcion', 'BT']],
    body: rows.length ? rows : [['', '', '', '', '', '', '', '', '', '']],
    foot: [
      [{ content: 'SUB-TOTALES', colSpan: 3, styles: { halign: 'right' } }, num(sub.aliment), num(sub.petroleo), num(sub.peajes), num(sub.materiales), num(sub.otros), '', ''],
      [{ content: 'TOTAL', colSpan: 3, styles: { halign: 'right' } }, { content: num(total), colSpan: 5, styles: { halign: 'right' } }, '', '']
    ],
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 0.8, overflow: 'linebreak', lineWidth: 0.1, lineColor: [90, 90, 90], valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: 255, fontSize: 7, halign: 'center', valign: 'middle', lineWidth: 0.1, lineColor: [90, 90, 90] },
    footStyles: { fillColor: [238, 242, 251], textColor: 0, fontStyle: 'bold', lineWidth: 0.1, lineColor: [90, 90, 90] },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' }, 1: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 17, halign: 'center' },
      3: { cellWidth: 13, halign: 'right' }, 4: { cellWidth: 13, halign: 'right' }, 5: { cellWidth: 15, halign: 'right' }, 6: { cellWidth: 15, halign: 'right' }, 7: { cellWidth: 13, halign: 'right' },
      8: { halign: 'left' }, 9: { cellWidth: 26, halign: 'center' }
    }
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 3,
    margin: { left: W - 92, right: 12 },
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 1.1, lineWidth: 0.1, lineColor: [90, 90, 90] },
    body: [
      ['Total', '$ ' + num(total)],
      ['Saldo', '$ ' + (bal.saldo < 0 ? '-' : '') + num(Math.abs(bal.saldo))]
    ],
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [238, 242, 251] }, 1: { halign: 'right' } }
  });

  const halfW = (W - 24) / 2;
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 6,
    margin: { left: 12, right: 12 },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.4, lineWidth: 0.1, lineColor: [90, 90, 90], valign: 'top' },
    body: [
      [{ content: 'Fecha rendicion', styles: { minCellHeight: 11 } }, { content: 'Fecha Revision y Aprobacion', styles: { minCellHeight: 11 } }],
      [{ content: 'Observaciones:', colSpan: 2 }],
      [{ content: 'Traspaso N', colSpan: 2 }]
    ],
    columnStyles: { 0: { cellWidth: halfW }, 1: { cellWidth: halfW } }
  });

  doc.setFontSize(7.5); doc.setTextColor(130, 130, 130);
  doc.text(`${owner?.company || ''} - Generado por RindeApp Cloud - ${new Date().toLocaleString('es-CL')}`,
    12, doc.internal.pageSize.getHeight() - 8);

  return doc.output('blob');
}

// Genera el PDF de boletas como Blob (o null si no hay boletas).
async function receiptsPdf(r) {
  const expenses = store.getReportExpenses(r.id).filter((e) => e.receipts?.length)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!expenses.length) return null;

  const doc = await newDoc('portrait');
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const NAVY = [27, 58, 140];
  const mL = 10, mT = 12, mB = 12, gap = 6;
  const colW = (W - mL * 2 - gap) / 2;
  const maxImgH = 88;

  try { doc.addImage(LOGO_DATAURL, 'PNG', mL, 8, 14, 10); } catch (e) {}
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...NAVY);
  doc.text('Boletas - ' + (r.title || ''), mL + 18, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text(`Rend. N ${r.rendNumber || ''} - ${monthLabel(r.period)} - ${expenses.length} boleta(s)`, mL + 18, 19);
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(mL, 22, W - mL, 22);

  const groups = {};
  for (const e of expenses) (groups[e.date] = groups[e.date] || []).push(e);

  let y = 28, col = 0, rowMaxH = 0;
  const newRow = () => { if (col > 0) { y += rowMaxH + 5; col = 0; rowMaxH = 0; } };

  for (const date of Object.keys(groups).sort()) {
    newRow();
    if (y + 9 > H - mB) { doc.addPage(); y = mT; }
    doc.setFillColor(238, 242, 251);
    doc.rect(mL, y, W - mL * 2, 7, 'F');
    doc.setTextColor(...NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(formatDateLong(date), mL + 3, y + 5);
    y += 10;

    for (const e of groups[date]) {
      const rcpts = e.receipts || [];
      for (let ri = 0; ri < rcpts.length; ri++) {
        const blob = await storage.downloadReceiptBlob(rcpts[ri].path);
        if (!blob) continue;
        const dataUrl = await blobToDataURL(blob);
        let props;
        try { props = doc.getImageProperties(dataUrl); } catch (_) { continue; }
        const ratio = props.height / props.width;
        let imgW = colW, imgH = imgW * ratio;
        if (imgH > maxImgH) { imgH = maxImgH; imgW = imgH / ratio; }
        const cellH = imgH + 14;
        if (y + cellH > H - mB) { doc.addPage(); y = mT; col = 0; rowMaxH = 0; }

        const cellX = mL + col * (colW + gap);
        const imgX = cellX + (colW - imgW) / 2;
        const fmt = String(props.fileType || 'JPEG').toUpperCase().indexOf('PNG') >= 0 ? 'PNG' : 'JPEG';
        try { doc.addImage(dataUrl, fmt, imgX, y, imgW, imgH); } catch (_) {}
        doc.setDrawColor(205); doc.setLineWidth(0.2); doc.rect(cellX, y - 1, colW, imgH + 2);

        const c = store.getCategory(e.categoryId);
        const bt = store.getBT(e.btId);
        const extra = rcpts.length > 1 ? ` (foto ${ri + 1}/${rcpts.length})` : '';
        const cap = `${formatMoney(store.finalAmount(e), e.currency)} ${c.name}${extra}\n${e.merchant || ''}${e.docNumber ? '  ' + (e.docType === 'factura' ? 'Fact' : 'Bol') + ' ' + e.docNumber : ''}${bt ? '  BT ' + bt.code : ''}`;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(20, 20, 20);
        doc.text(doc.splitTextToSize(cap, colW - 2), cellX + 1, y + imgH + 4);

        rowMaxH = Math.max(rowMaxH, cellH);
        col++;
        if (col === 2) { y += rowMaxH + 5; col = 0; rowMaxH = 0; }
      }
    }
  }
  return doc.output('blob');
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ====== Acciones: descargar PDF al telefono / enviar por WhatsApp ======
async function downloadRendicion(r) {
  toast('Generando PDF...');
  try {
    const blob = await rendicionPdf(r);
    downloadFile(`rendicion-${safeName(r.rendNumber || r.title)}.pdf`, blob, 'application/pdf');
    toast('Rendicion descargada', 'ok');
  } catch (e) { toast('No se pudo generar el PDF', 'err'); }
}

async function downloadReceipts(r) {
  toast('Generando PDF de boletas...');
  try {
    const blob = await receiptsPdf(r);
    if (!blob) { toast('Esta rendicion no tiene boletas adjuntas', 'err'); return; }
    downloadFile(`boletas-${safeName(r.rendNumber || r.title)}.pdf`, blob, 'application/pdf');
    toast('Boletas descargadas', 'ok');
  } catch (e) { toast('No se pudo generar el PDF', 'err'); }
}

async function sendViaWhatsapp(r) {
  toast('Preparando envio...');
  try {
    const name = safeName(r.rendNumber || r.title);
    const files = [];
    const rend = await rendicionPdf(r);
    if (rend) files.push(pdfFile(rend, `rendicion-${name}.pdf`));
    const rec = await receiptsPdf(r);
    if (rec) files.push(pdfFile(rec, `boletas-${name}.pdf`));

    const owner = store.getProfileById(r.ownerId) || store.getProfile();
    const text = `Rendicion ${r.title}${r.rendNumber ? ' (N ' + r.rendNumber + ')' : ''} - ${owner?.fullName || ''}`;
    const res = await shareFiles(files, { title: 'Rendicion ' + r.title, text });
    if (res === 'shared') { toast('Compartido', 'ok'); return; }
    if (res === 'cancel') { toast('Envio cancelado'); return; }
    for (const f of files) downloadFile(f.name, f, 'application/pdf');
    window.open('https://wa.me/?text=' + encodeURIComponent(text + ' (adjunto los PDF descargados)'), '_blank');
    toast('Adjunta los PDF descargados en WhatsApp', 'ok');
  } catch (e) { toast('No se pudo preparar el envio', 'err'); }
}

// ============ ESTADISTICAS ============
let statRange = 'month';
export function renderStats() {
  let expenses = store.getExpenses();
  if (statRange === 'month') expenses = expenses.filter((e) => monthKey(e.date) === monthKey(undefined));
  const total = expenses.reduce((a, e) => a + store.finalAmount(e), 0);
  const catData = store.byCategory(expenses);
  const months = store.lastMonths(6);
  const avgMonth = months.reduce((a, m) => a + m.total, 0) / (months.filter((m) => m.total > 0).length || 1);

  const html = `
    <div class="chips" style="margin-bottom:10px">
      <button class="chip ${statRange === 'month' ? 'active' : ''}" data-range="month">Este mes</button>
      <button class="chip ${statRange === 'all' ? 'active' : ''}" data-range="all">Todo</button>
    </div>

    <div class="kpis" style="margin-bottom:6px">
      <div class="kpi"><div class="v mono">${formatMoney(total, cur())}</div><div class="k">Total ${statRange === 'month' ? 'del mes' : 'historico'}</div></div>
      <div class="kpi"><div class="v">${expenses.length}</div><div class="k">Cantidad de gastos</div></div>
      <div class="kpi"><div class="v mono">${formatMoney(expenses.length ? total / expenses.length : 0, cur())}</div><div class="k">Gasto promedio</div></div>
      <div class="kpi"><div class="v mono">${formatMoney(avgMonth, cur())}</div><div class="k">Promedio mensual</div></div>
    </div>

    <div class="section-title">Evolucion (ultimos 6 meses)</div>
    <div class="card">${monthBars(months, cur())}</div>

    <div class="section-title">Por categoria</div>
    <div class="card">
      ${catData.length ? donutChart(catData, cur()) : '<p class="muted center" style="padding:14px 0">Sin datos en este periodo</p>'}
    </div>
    ${catData.length ? `<div class="card">${barList(catData, cur())}</div>` : ''}
  `;
  return { html, mount: (root) => {
    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { statRange = b.dataset.range; navigate('stats'); }));
  }};
}

// ============ AJUSTES ============
export function renderSettings() {
  const p = store.getProfile();
  const role = store.myRole();
  const html = `
    <div class="card" style="display:flex;align-items:center;gap:14px">
      <div class="emoji" style="width:54px;height:54px;font-size:24px;background:var(--primary-soft)">👤</div>
      <div style="flex:1">
        <div style="font-weight:650;font-size:17px">${esc(p?.fullName || 'Sin nombre')}</div>
        <div class="muted tiny">${esc(p?.rut || '')} - ${roleLabelText(role)}</div>
      </div>
      <button class="btn sm outline" data-act="profile">Editar</button>
    </div>

    ${role === 'reviewer' || role === 'admin' ? `
    <div class="section-title">Revision</div>
    <div class="settings-list">
      <button class="si" data-act="panel"><span class="ic">🔎</span><span class="lbl">Panel de revision</span><span class="chev"></span></button>
      ${role === 'admin' ? `<button class="si" data-act="admin"><span class="ic">🛠️</span><span class="lbl">Administracion</span><span class="chev"></span></button>` : ''}
    </div>` : ''}

    <div class="section-title">Preferencias</div>
    <div class="settings-list">
      <button class="si" data-act="bts">
        <span class="ic">🏷️</span><span class="lbl">BT / Proyectos</span>
        <span class="val">${store.getBTs().length}</span><span class="chev"></span>
      </button>
      <button class="si" id="pushToggle" data-act="push">
        <span class="ic">🔔</span><span class="lbl">Notificaciones push</span>
        <span class="val" id="pushStatus">...</span><span class="chev"></span>
      </button>
    </div>

    <div class="section-title">Cuenta</div>
    <div class="settings-list">
      <button class="si" data-act="logout"><span class="ic">🚪</span><span class="lbl" style="color:var(--danger)">Cerrar sesion</span><span class="chev"></span></button>
    </div>

    <div class="storage-note">
      <b>Datos en la nube</b>
      <span>Tus gastos y rendiciones se guardan en el servidor y se sincronizan al instante con el equipo revisor.</span>
    </div>
  `;
  return { html, mount: async (root) => {
    root.querySelector('[data-act="profile"]').onclick = () => openProfileForm();
    root.querySelector('[data-act="bts"]').onclick = () => navigate('bts');
    root.querySelector('[data-act="panel"]')?.addEventListener('click', () => navigate('panel'));
    root.querySelector('[data-act="admin"]')?.addEventListener('click', () => navigate('admin'));
    root.querySelector('[data-act="logout"]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Cerrar sesion', message: 'Volveras a la pantalla de ingreso.', confirmText: 'Cerrar sesion' });
      if (ok) { const { logout } = await import('./app.js'); await logout(); }
    };

    const push = await import('./push.js');
    const statusEl = root.querySelector('#pushStatus');
    const refreshPushStatus = async () => {
      const state = await push.getSubscriptionState();
      statusEl.textContent = state === 'subscribed' ? 'Activadas' : state === 'denied' ? 'Bloqueadas' : state === 'unsupported' ? 'No disponible' : 'Desactivadas';
    };
    refreshPushStatus();
    root.querySelector('[data-act="push"]').onclick = async () => {
      try {
        const state = await push.getSubscriptionState();
        if (state === 'subscribed') { await push.unsubscribeFromPush(); toast('Notificaciones desactivadas'); }
        else { await push.subscribeToPush(store.myUserId()); toast('Notificaciones activadas', 'ok'); }
      } catch (e) { toast(e.message || 'No se pudo cambiar', 'err'); }
      refreshPushStatus();
    };
  }};
}
function roleLabelText(role) { return role === 'admin' ? 'Administrador' : role === 'reviewer' ? 'Revisora' : 'Trabajador'; }

// ============ BT / PROYECTOS ============
export function renderBTs() {
  const bts = store.getBTs();
  const canManage = store.isReviewerOrAdmin();
  const html = `
    ${canManage ? `<button class="btn primary" data-act="new" style="margin-bottom:14px">+ Nueva BT / Proyecto</button>` : ''}
    <p class="muted tiny" style="margin:-6px 2px 12px">${canManage ? 'Crea y administra las BT (proyectos) de la empresa.' : 'BT (proyectos) disponibles para asignar a tus gastos.'}</p>
    ${bts.length ? bts.map((b) => {
      const count = store.getAllExpenses().filter((e) => e.btId === b.id).length;
      return `<div class="manage-row">
        <span class="nm">${esc(b.code)}${b.name ? ' - ' + esc(b.name) : ''}<br><span class="muted tiny">${count} gasto(s)</span></span>
        ${canManage ? `<button data-edit="${b.id}">Editar</button><button class="del" data-del="${b.id}">Eliminar</button>` : ''}
      </div>`;
    }).join('') : emptyInline('', 'Sin BT todavia', canManage ? 'Crea la primera BT / proyecto' : 'Aun no hay BT creadas')}
  `;
  return { html, mount: (root) => {
    root.querySelector('[data-act="new"]')?.addEventListener('click', () => openBTForm());
    root.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openBTForm(b.dataset.edit));
    root.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const bt = store.getBT(b.dataset.del);
      const ok = await confirmDialog({ title: 'Eliminar BT', message: `Los gastos de "${bt?.code}" quedaran sin BT. Continuar?`, confirmText: 'Eliminar', danger: true });
      if (ok) { await store.deleteBT(b.dataset.del); toast('BT eliminada'); navigate('bts'); }
    });
  }};
}

// ============ PANEL DE REVISION (revisora / admin) ============
let panelFilter = 'pending';
export function renderReviewerPanel() {
  const workers = store.getAllProfiles().filter((p) => p.role === 'worker');
  const workerRows = workers.map((w) => {
    const t = store.totals(w.id);
    const pending = store.getExpenses(w.id).filter((e) => e.reviewStatus === 'pending').length;
    return `<div class="manage-row">
      <span class="nm">${esc(w.fullName || w.rut)}<br><span class="muted tiny">Saldo ${formatMoney(t.availableBalance, cur())} ${pending ? '- ' + pending + ' sin revisar' : ''}</span></span>
      <button data-edit-worker="${w.id}">Editar</button>
      <button data-remind="${w.id}">Recordar</button>
      <button data-fund="${w.id}">+ Fondo</button>
    </div>`;
  }).join('');

  const chips = `
    <div class="chips">
      <button class="chip ${panelFilter === 'pending' ? 'active' : ''}" data-pf="pending">Pendientes</button>
      <button class="chip ${panelFilter === 'all' ? 'active' : ''}" data-pf="all">Todos</button>
      <button class="chip ${panelFilter === 'objected' ? 'active' : ''}" data-pf="objected">Objetados</button>
      <button class="chip ${panelFilter === 'clarification_requested' ? 'active' : ''}" data-pf="clarification_requested">Aclaracion</button>
    </div>`;

  const html = `
    <div class="row between" style="margin-bottom:4px">
      <div class="section-title" style="margin:0">Trabajadores (${workers.length})</div>
      <button class="mini-link" data-action="broadcast">📢 Aviso general</button>
    </div>
    ${workers.length ? workerRows : emptyInline('', 'Sin trabajadores aun', 'Apareceran aqui cuando se registren')}

    <div class="row between" style="margin:18px 2px 8px">
      <div class="section-title" style="margin:0">Gastos subidos</div>
    </div>
    ${chips}
    <div id="panelExpList"></div>
  `;
  return { html, mount: (root) => {
    root.querySelector('[data-action="broadcast"]')?.addEventListener('click', () => openBroadcastForm());
    root.querySelectorAll('[data-edit-worker]').forEach((b) => b.onclick = () => openProfileForm(b.dataset.editWorker));
    root.querySelectorAll('[data-remind]').forEach((b) => b.onclick = () => sendManualReminder(b.dataset.remind, 'manual_reminder'));
    root.querySelectorAll('[data-fund]').forEach((b) => b.onclick = () => openTransferForm(null, b.dataset.fund));
    root.querySelectorAll('[data-pf]').forEach((b) => b.onclick = () => { panelFilter = b.dataset.pf; navigate('panel'); });

    const wrap = root.querySelector('#panelExpList');
    let expenses = store.getAllExpenses();
    if (panelFilter !== 'all') expenses = expenses.filter((e) => e.reviewStatus === panelFilter);
    wrap.innerHTML = `<div class="list">${expenses.length ? expenses.slice(0, 60).map((e) => expenseItem(e, { showOwner: true })).join('') : emptyInline('👍', 'Nada por aqui', 'No hay gastos en este filtro')}</div>`;
    hydrateThumbs(wrap);
    wrap.querySelectorAll('[data-action="expense"]').forEach((el) =>
      el.addEventListener('click', () => navigate('panelExpense/' + el.dataset.id)));
  }};
}

// ============ DETALLE DE GASTO (vista de revisora) ============
export function renderReviewerExpenseDetail(id) {
  const e = store.getExpense(id);
  if (!e) return { html: emptyInline('🤔', 'Gasto no encontrado', ''), mount: () => {} };
  const c = store.getCategory(e.categoryId);
  const owner = store.getProfileById(e.ownerId);
  const report = e.reportId ? store.getReport(e.reportId) : null;
  const comments = store.getComments('expense', id);

  const html = `
    <div class="card">
      <div class="muted tiny">${esc(owner?.fullName || owner?.rut || '')}</div>
      <div class="detail-amount" style="margin-top:6px">
        <div class="big mono">${formatMoney(e.amount, e.currency)}</div>
        <div class="cat">${c.emoji} ${esc(c.name)}</div>
      </div>
      ${e.reviewStatus !== 'pending' ? `<div class="card tight" style="margin-top:6px"><b>${REVIEW_BADGE[e.reviewStatus] || ''} ${reviewStatusLabel(e.reviewStatus)}</b>${e.approvedAmount != null ? ` - ${formatMoney(e.approvedAmount, e.currency)}` : ''}${e.reviewerComment ? `<div class="muted tiny">"${esc(e.reviewerComment)}"</div>` : ''}</div>` : ''}
    </div>
    <div class="card">
      <div class="kv"><span class="k">Comercio</span><span class="v">${esc(e.merchant || '')}</span></div>
      <div class="kv"><span class="k">Fecha</span><span class="v">${formatDate(e.date)}</span></div>
      <div class="kv"><span class="k">Documento</span><span class="v">${e.docType ? (e.docType === 'factura' ? 'Factura' : 'Boleta') : ''}${e.docNumber ? ' N ' + esc(e.docNumber) : ''}</span></div>
      <div class="kv"><span class="k">BT / Proyecto</span><span class="v">${e.btId ? esc(store.btLabel(e.btId)) : 'Sin BT'}</span></div>
      <div class="kv"><span class="k">Rendicion</span><span class="v">${report ? esc(report.title) : 'Sin asignar'}</span></div>
    </div>
    ${e.notes ? `<div class="card"><div class="muted tiny" style="margin-bottom:4px">Notas</div>${esc(e.notes)}</div>` : ''}
    ${comments.length ? `<div class="card"><div class="muted tiny" style="margin-bottom:4px">Comentarios</div>${comments.map((c) => `<div class="tiny" style="margin-bottom:4px">${esc(c.body)}</div>`).join('')}</div>` : ''}
    <div id="receiptBox"></div>
    <button class="btn primary" data-act="review" style="width:100%;margin-top:10px">Revisar gasto</button>
  `;
  return { html, mount: async (root) => {
    root.querySelector('[data-act="review"]').onclick = () => openReviewForm(id);
    if (e.receipts?.length) {
      let imgs = '';
      for (const r of e.receipts) {
        const url = await storage.getReceiptUrl(r.path);
        if (url) imgs += `<img class="receipt-img" src="${url}" alt="boleta" style="margin-bottom:8px"/>`;
      }
      if (imgs) root.querySelector('#receiptBox').innerHTML = `<div class="section-title">Boleta${e.receipts.length > 1 ? 's' : ''}</div>${imgs}`;
    }
  }};
}

// ============ DETALLE DE RENDICION (vista de revisora) ============
export function renderReviewerReportDetail(id) {
  const r = store.getReport(id);
  if (!r) return { html: emptyInline('🤔', 'Rendicion no encontrada', ''), mount: () => {} };
  const owner = store.getProfileById(r.ownerId);
  const expenses = store.getReportExpenses(id);
  const total = store.reportTotal(id);
  const bal = store.reportBalance(id);

  const html = `
    <div class="card">
      <div class="muted tiny">${esc(owner?.fullName || owner?.rut || '')}</div>
      <h2 style="margin:6px 0 2px;font-size:21px">${esc(r.title)}</h2>
      <div class="muted">${r.rendNumber ? 'Rend. N ' + esc(r.rendNumber) + ' - ' : ''}${monthLabel(r.period)}</div>
      ${r.obra ? `<div class="muted tiny" style="margin-top:2px">${esc(r.obra)}</div>` : ''}
      <hr class="hr"/>
      <div class="row between"><span class="muted">Total rendido</span><b class="mono" style="font-size:20px">${formatMoney(total, cur())}</b></div>
      <div class="row between" style="margin-top:4px"><span class="muted tiny">Monto asignado</span><span class="mono tiny">${formatMoney(bal.opening, cur())}</span></div>
      <div class="row between"><span class="muted tiny">Saldo</span><span class="mono tiny" style="color:${bal.saldo < 0 ? 'var(--danger)' : 'var(--success)'}">${formatMoney(bal.saldo, cur())}</span></div>
    </div>
    <div class="report-actions no-print">
      <button class="btn outline" data-act="download">Descargar rendicion</button>
      <button class="btn outline" data-act="download-receipts">Descargar boletas</button>
    </div>
    <div class="section-title">Gastos incluidos</div>
    <div class="list">${expenses.length ? expenses.map((e) => expenseItem(e)).join('') : emptyInline('🧾', 'Sin gastos', '')}</div>
  `;
  return { html, mount: (root) => {
    hydrateThumbs(root);
    root.querySelector('[data-act="download"]')?.addEventListener('click', () => downloadRendicion(r));
    root.querySelector('[data-act="download-receipts"]')?.addEventListener('click', () => downloadReceipts(r));
    root.querySelectorAll('[data-action="expense"]').forEach((el) =>
      el.addEventListener('click', () => navigate('panelExpense/' + el.dataset.id)));
  }};
}

// ============ ADMINISTRACION (solo admin) ============
export function renderAdminPanel() {
  const profiles = store.getAllProfiles();
  const rows = profiles.map((p) => `
    <div class="manage-row">
      <span class="nm">${esc(p.fullName || p.rut)}<br><span class="muted tiny">${esc(p.rut)} - ${roleLabelText(p.role)}</span></span>
      ${p.id !== store.myUserId() ? `
        <select data-role="${p.id}" class="select" style="width:auto">
          <option value="worker" ${p.role === 'worker' ? 'selected' : ''}>Trabajador</option>
          <option value="reviewer" ${p.role === 'reviewer' ? 'selected' : ''}>Revisora</option>
          <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>` : '<span class="muted tiny">(tu)</span>'}
    </div>`).join('');

  const html = `
    <div class="section-title">BT / Proyectos</div>
    <button class="btn outline" data-act="bts" style="width:100%;margin-bottom:14px">Gestionar BT / Proyectos</button>
    <div class="section-title">Cuentas (${profiles.length})</div>
    ${rows}
  `;
  return { html, mount: (root) => {
    root.querySelector('[data-act="bts"]').onclick = () => navigate('bts');
    root.querySelectorAll('[data-role]').forEach((sel) => sel.onchange = async () => {
      const ok = await confirmDialog({ title: 'Cambiar rol', message: `Se cambiara el rol de esta cuenta a "${roleLabelText(sel.value)}".`, confirmText: 'Cambiar' });
      if (!ok) { navigate('admin'); return; }
      try { await store.setRole(sel.dataset.role, sel.value); toast('Rol actualizado', 'ok'); }
      catch (e) { toast('No se pudo cambiar: ' + (e.message || e), 'err'); navigate('admin'); }
    });
  }};
}

// ===== wiring comun =====
function wireExpenseItems(root) {
  root.querySelectorAll('[data-action="expense"]').forEach((el) =>
    el.addEventListener('click', () => openExpenseDetail(el.dataset.id)));
}
function wireReportItems(root) {
  root.querySelectorAll('[data-action="report"]').forEach((el) =>
    el.addEventListener('click', () => navigate('report/' + el.dataset.id)));
}
