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
  openProfileForm, openBTForm, openCargoForm, openTransferForm, openReviewForm,
  openBroadcastForm, openImportBackupForm, openResolveApprovalForm, openNotifyWorkerForm
} from './forms.js';
import { LOGO_DATAURL } from './assets.js';
import { newDoc, shareFiles, pdfFile } from './pdf.js';
import { canInstall, promptInstall, canShowIOSInstallHint, showIOSInstallHelp } from './installPrompt.js';

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
  approved: '✅', adjusted: '✏️', objected: '❌', clarification_requested: '❓', sent_for_approval: '📤'
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
  const isAdmin = store.myRole() === 'admin';
  const adminPending = isAdmin ? teamPendingCount() : 0;
  const badgeCount = store.getBadgeCount();

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

    ${canInstall() ? `
    <button class="notice-card" data-action="install">
      <span><b>📲 Instalar app</b></span>
      <small>Para que las notificaciones lleguen bien</small>
    </button>` : ''}

    ${canShowIOSInstallHint() ? `
    <button class="notice-card" data-action="ios-install">
      <span><b>📲 Instalar en iPhone</b></span>
      <small>Compartir → Agregar a inicio</small>
    </button>` : ''}

    ${t.unassignedCount > 0 ? `
    <button class="notice-card" data-action="goexpenses">
      <span><b>${t.unassignedCount}</b> gasto(s) sin rendicion</span>
      <small>Revisar y asignar</small>
    </button>` : ''}

    <button class="btn primary" data-action="new-expense" style="width:100%;margin-bottom:16px">📸 Nuevo gasto</button>

    <div class="tilegrid" style="margin-bottom:20px">
      <button class="tile" data-nav="expenses">
        <div class="ico tint-primary">🧾</div>
        <b>Mis gastos</b>
        <span class="desc">Historial completo</span>
      </button>
      <button class="tile" data-nav="reports">
        <div class="ico tint-info">📋</div>
        <b>Mis rendiciones</b>
        <span class="desc">Todas agrupadas por BT</span>
      </button>
      <button class="tile" data-nav="inbox">
        ${badgeCount ? `<span class="count-bubble tile-count">${badgeCount}</span>` : ''}
        <div class="ico tint-success">🔔</div>
        <b>Mis notificaciones</b>
        <span class="desc">Avisos para ti</span>
      </button>
      <button class="tile" data-nav="settings">
        <div class="ico tint-neutral">⚙️</div>
        <b>Ajustes</b>
        <span class="desc">Cuenta y app</span>
      </button>
      ${isAdmin ? `
      <button class="tile priv" data-nav="admin">
        ${adminPending ? `<span class="count-bubble tile-count">${adminPending}</span>` : ''}
        <div class="ico tint-primary">🛠️</div>
        <b>Panel de administración</b>
        <span class="desc">Revisión y administración</span>
      </button>` : ''}
    </div>

    ${activeReports.length ? `
      <div class="section-title">Rendiciones abiertas</div>
      <div class="list">${activeReports.map(reportItem).join('')}</div>
    ` : ''}

    <div class="row between" style="margin:18px 2px 10px">
      <div class="section-title" style="margin:0">Ultimos gastos</div>
      <a href="#/expenses" class="tiny">Ver todos</a>
    </div>
    <div class="list">
      ${recent.length ? recent.map((e) => expenseItem(e)).join('') : emptyInline('🧾', 'Sin gastos todavia', 'Toca Nuevo gasto para agregar la primera boleta')}
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
    root.querySelector('[data-action="install"]')?.addEventListener('click', async () => { await promptInstall(); navigate('dashboard'); });
    root.querySelector('[data-action="ios-install"]')?.addEventListener('click', () => showIOSInstallHelp());
    root.querySelectorAll('[data-action="transfer"]').forEach((b) => b.addEventListener('click', () => openTransferForm()));
    root.querySelector('[data-action="new-expense"]')?.addEventListener('click', () => openExpenseForm());
    root.querySelectorAll('[data-action="edit-transfer"]').forEach((b) => b.addEventListener('click', () => openTransferForm(b.dataset.id)));
    root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
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
  return {
    approved: 'Aprobado', adjusted: 'Ajustado', objected: 'Objetado',
    clarification_requested: 'Aclaracion solicitada', sent_for_approval: 'Enviado a aprobacion'
  }[status] || '';
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
  doc.text(`${owner?.company || ''} - Generado por RendiMTQ - ${new Date().toLocaleString('es-CL')}`,
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

// ============ METRICAS DEL EQUIPO (revisora / admin) ============
let teamMetricsRange = 'month';
export function renderTeamMetrics() {
  let expenses = store.getAllExpenses();
  if (teamMetricsRange === 'month') expenses = expenses.filter((e) => monthKey(e.date) === monthKey(undefined));
  const total = expenses.reduce((a, e) => a + store.finalAmount(e), 0);
  const catData = store.byCategory(expenses);
  const btData = store.byBT(expenses);
  const maxBT = Math.max(...btData.map((b) => b.total), 1);

  const months = [];
  const base = new Date(); base.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mTotal = store.getAllExpenses().filter((e) => monthKey(e.date) === ym).reduce((a, e) => a + store.finalAmount(e), 0);
    months.push({ ym, total: mTotal });
  }

  const workers = controllableProfiles();
  const totalPending = teamPendingCount();

  const html = `
    <div class="chips" style="margin-bottom:10px">
      <button class="chip ${teamMetricsRange === 'month' ? 'active' : ''}" data-range="month">Este mes</button>
      <button class="chip ${teamMetricsRange === 'all' ? 'active' : ''}" data-range="all">Todo</button>
    </div>

    <div class="kpis" style="margin-bottom:6px">
      <div class="kpi"><div class="v mono">${formatMoney(total, cur())}</div><div class="k">Total gastado ${teamMetricsRange === 'month' ? 'este mes' : 'historico'}</div></div>
      <div class="kpi warn"><div class="v">${totalPending}</div><div class="k">Pendientes de revisar</div></div>
      <div class="kpi"><div class="v">${expenses.length}</div><div class="k">Gastos registrados</div></div>
      <div class="kpi"><div class="v">${workers.length}</div><div class="k">Colaboradores</div></div>
    </div>

    <div class="section-title">Evolucion del equipo (ultimos 6 meses)</div>
    <div class="card">${monthBars(months, cur())}</div>

    <div class="section-title">Por BT / Proyecto</div>
    <div class="card">
      ${btData.length ? `<div class="bars">` + btData.map((b) => `
        <div class="bar-row">
          <div class="bar-top">
            <span>${esc(b.bt ? store.btLabel(b.bt.id) : 'Sin proyecto asignado')}</span>
            <span class="mono">${formatMoney(b.total, cur())}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${(b.total / maxBT * 100).toFixed(0)}%"></div></div>
        </div>`).join('') + `</div>` : '<p class="muted center" style="padding:14px 0">Sin datos en este periodo</p>'}
    </div>

    <div class="section-title">Por categoria</div>
    <div class="card">
      ${catData.length ? donutChart(catData, cur()) : '<p class="muted center" style="padding:14px 0">Sin datos en este periodo</p>'}
    </div>
  `;
  return { html, mount: (root) => {
    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { teamMetricsRange = b.dataset.range; navigate('metrics'); }));
  }};
}

// ============ NOTIFICACIONES (revisora / admin) ============
const NOTIF_TYPE_LABEL = {
  manual_reminder: 'Recordatorio', closure_reminder: 'Cierre de rendicion', objected: 'Objecion',
  approved: 'Aprobacion', adjusted: 'Ajuste', clarification_requested: 'Aclaracion', broadcast: 'Aviso general',
  manual: 'Manual', approval_request: 'Solicitud de aprobacion'
};
export function renderNotificationsHub() {
  const workers = controllableProfiles();
  const workerRows = workers.map((w) => `
    <div class="manage-row">
      <span class="nm">${esc(w.fullName || w.rut)}</span>
      <button data-notify="${w.id}">Enviar mensaje</button>
    </div>`).join('');

  const html = `
    <button class="btn primary" data-action="broadcast" style="width:100%;margin-bottom:16px">📢 Enviar aviso general</button>

    <div class="section-title">Mensajes individuales</div>
    ${workers.length ? workerRows : emptyInline('', 'Sin colaboradores aun', '')}

    <div class="section-title" style="margin-top:18px">Historial reciente</div>
    <div id="notifLog"><p class="muted center">Cargando...</p></div>
  `;
  return { html, mount: async (root) => {
    root.querySelector('[data-action="broadcast"]').onclick = () => openBroadcastForm();
    root.querySelectorAll('[data-notify]').forEach((b) => b.onclick = () => openNotifyWorkerForm(b.dataset.notify));

    const log = await store.getRecentNotifications(30);
    const wrap = root.querySelector('#notifLog');
    if (!log.length) { wrap.innerHTML = '<p class="muted center">Sin notificaciones enviadas aun</p>'; return; }
    wrap.innerHTML = log.map((n) => {
      const recipient = store.getProfileById(n.recipientId);
      return `<div class="card tight" style="margin-bottom:8px">
        <div class="row between"><b>${esc(n.title)}</b><span class="muted tiny">${formatDate(new Date(n.createdAt).toISOString().slice(0, 10))}</span></div>
        <div class="muted tiny">${esc(recipient?.fullName || recipient?.rut || 'Colaborador')} - ${NOTIF_TYPE_LABEL[n.type] || n.type}</div>
        ${n.body ? `<div class="tiny" style="margin-top:4px">${esc(n.body)}</div>` : ''}
      </div>`;
    }).join('');
  }};
}

// ============ MIS NOTIFICACIONES (panel personal, cualquier rol) ============
// A diferencia del hub de arriba (que es para revisora/admin ENVIAR avisos),
// esta pantalla es el buzon personal de cada cuenta: lo que le mandaron a
// ella. Las solicitudes de aprobacion pendientes se quedan arriba, visibles,
// hasta que la persona realmente actua (aprobar/rechazar) - no desaparecen solas.
export function renderMyNotifications() {
  const pending = store.getPendingApprovalsForMe();
  const notifs = store.getMyNotifications();

  const pendingRows = pending.map((r) => {
    const e = store.getExpense(r.expenseId);
    const requester = store.getProfileById(r.requestedBy);
    if (!e) return '';
    return `<div class="card tight" style="margin-bottom:8px;border:1px solid var(--warning)">
      <div class="row between"><b>📤 Solicitud de aprobacion</b><span class="muted tiny">${formatDate(new Date(r.createdAt).toISOString().slice(0, 10))}</span></div>
      <div class="muted tiny" style="margin-top:4px">De ${esc(requester?.fullName || requester?.rut || '')} - ${esc(e.merchant || '')} - ${formatMoney(e.amount, e.currency)}</div>
      ${r.note ? `<div class="tiny" style="margin-top:4px">"${esc(r.note)}"</div>` : ''}
      <button class="btn primary sm" data-resolve="${r.id}" style="margin-top:8px">Revisar</button>
    </div>`;
  }).join('');

  const notifRows = notifs.map((n) => `
    <div class="card tight" style="margin-bottom:8px">
      <div class="row between"><b>${n.readAt ? '' : '🔵 '}${esc(n.title)}</b><span class="muted tiny">${formatDate(new Date(n.createdAt).toISOString().slice(0, 10))}</span></div>
      <div class="muted tiny">${NOTIF_TYPE_LABEL[n.type] || n.type}</div>
      ${n.body ? `<div class="tiny" style="margin-top:4px">${esc(n.body)}</div>` : ''}
    </div>`).join('');

  const html = `
    ${pending.length ? `
      <div class="section-title">Requieren tu accion (${pending.length})</div>
      <div style="margin-bottom:18px">${pendingRows}</div>
    ` : ''}
    <div class="section-title">Notificaciones</div>
    ${notifs.length ? notifRows : emptyInline('🔔', 'Sin notificaciones', 'Apareceran aqui los avisos y recordatorios que te manden')}
  `;
  return { html, mount: (root) => {
    root.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = () => {
      const req = pending.find((r) => r.id === b.dataset.resolve);
      if (req) openResolveApprovalForm(req);
    });
    store.markNotificationsRead().catch(() => {});
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

    <div class="section-title">Preferencias</div>
    <div class="settings-list">
      <button class="si" data-act="bts">
        <span class="ic">🏷️</span><span class="lbl">BT / Proyectos</span>
        <span class="val">${store.getBTs().length}</span><span class="chev"></span>
      </button>
      <button class="si" data-act="cargos">
        <span class="ic">🪪</span><span class="lbl">Cargos</span>
        <span class="val">${store.getCargos().length}</span><span class="chev"></span>
      </button>
      <button class="si" id="pushToggle" data-act="push">
        <span class="ic">🔔</span><span class="lbl">Notificaciones push</span>
        <span class="val" id="pushStatus">...</span><span class="chev"></span>
      </button>
    </div>

    <div class="section-title">Migracion</div>
    <div class="settings-list">
      <button class="si" data-act="import-backup"><span class="ic">📥</span><span class="lbl">Importar respaldo (Rendiciones App)</span><span class="chev"></span></button>
    </div>
    <p class="muted tiny" style="margin:-6px 2px 12px">Herramienta temporal para traer el historial de la app anterior. Se retirara cuando termine la migracion.</p>

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
    root.querySelector('[data-act="cargos"]').onclick = () => navigate('cargos');
    root.querySelector('[data-act="import-backup"]').onclick = () => openImportBackupForm();
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
function roleLabelText(role) { return role === 'reviewer' ? 'Revisora' : 'Colaborador'; }

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

// ============ CARGOS EN LA EMPRESA ============
export function renderCargos() {
  const cargos = store.getCargos();
  const canManage = store.isReviewerOrAdmin();
  const html = `
    ${canManage ? `<button class="btn primary" data-act="new" style="margin-bottom:14px">+ Nuevo cargo</button>` : ''}
    <p class="muted tiny" style="margin:-6px 2px 12px">${canManage ? 'Crea y administra los cargos que se pueden asignar a un colaborador.' : 'Cargos disponibles en la empresa.'}</p>
    ${cargos.length ? cargos.map((c) => {
      const count = store.getAllProfiles().filter((p) => p.cargoId === c.id).length;
      return `<div class="manage-row">
        <span class="nm">${esc(c.name)}<br><span class="muted tiny">${count} persona(s)</span></span>
        ${canManage ? `<button data-edit="${c.id}">Editar</button><button class="del" data-del="${c.id}">Eliminar</button>` : ''}
      </div>`;
    }).join('') : emptyInline('', 'Sin cargos todavia', canManage ? 'Crea el primer cargo' : 'Aun no hay cargos creados')}
  `;
  return { html, mount: (root) => {
    root.querySelector('[data-act="new"]')?.addEventListener('click', () => openCargoForm());
    root.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => openCargoForm(b.dataset.edit));
    root.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const cargo = store.getCargo(b.dataset.del);
      const ok = await confirmDialog({ title: 'Eliminar cargo', message: `Quienes tengan "${cargo?.name}" quedaran sin cargo asignado. Continuar?`, confirmText: 'Eliminar', danger: true });
      if (ok) { await store.deleteCargo(b.dataset.del); toast('Cargo eliminado'); navigate('cargos'); }
    });
  }};
}

// Cuentas que la revisora/admin puede controlar como si fueran trabajadores:
// los workers y tambien el admin (el es quien rinde sus propios gastos), pero
// nunca uno mismo (para no aparecer en el propio Panel).
function controllableProfiles() {
  return store.getAllProfiles().filter((p) =>
    (p.role === 'worker' || p.role === 'admin') && p.id !== store.myUserId());
}

// Ya no cuenta "pendientes de aprobar": la revisora no tiene que aprobar
// cada gasto, solo darse una vuelta por las boletas nuevas. El globo baja
// apenas abre cada gasto (store.markExpenseSeen), sin necesidad de aprobar.
function teamPendingCount() {
  return controllableProfiles().reduce((a, w) => a + store.getExpenses(w.id).filter((e) => !e.seen).length, 0);
}

// BT/Cargos comparten una sola tarjeta de acceso; aca se resuelve a cual de
// las dos pantallas entrar.
async function openProjectsMenu() {
  const idx = await actionSheet('Proyectos y cargos', [{ label: 'BT / Proyectos' }, { label: 'Cargos' }]);
  if (idx === 0) navigate('bts');
  else if (idx === 1) navigate('cargos');
}

// ============ INICIO DE LA REVISORA (pantalla de accesos) ============
// La revisora "pura" no rinde sus propios gastos, asi que su Inicio es esta
// grilla de accesos en vez del dashboard de saldo/gastos del colaborador.
export function renderReviewerHome() {
  const pending = teamPendingCount();
  const badgeCount = store.getBadgeCount();

  const html = `
    ${canInstall() ? `
    <button class="notice-card" data-action="install">
      <span><b>📲 Instalar app</b></span>
      <small>Para que las notificaciones lleguen bien</small>
    </button>` : ''}

    ${canShowIOSInstallHint() ? `
    <button class="notice-card" data-action="ios-install">
      <span><b>📲 Instalar en iPhone</b></span>
      <small>Compartir → Agregar a inicio</small>
    </button>` : ''}

    <div class="tilegrid">
      <button class="tile" data-nav="reviewQueue">
        ${pending ? `<span class="count-bubble tile-count">${pending}</span>` : ''}
        <div class="ico tint-primary">🗂️</div>
        <b>Administrar rendiciones</b>
        <span class="desc">Revisar y aprobar</span>
      </button>
      <button class="tile" data-nav="metrics">
        <div class="ico tint-info">📊</div>
        <b>Métricas</b>
        <span class="desc">Gasto del equipo</span>
      </button>
      <button class="tile" data-nav="inbox">
        ${badgeCount ? `<span class="count-bubble tile-count">${badgeCount}</span>` : ''}
        <div class="ico tint-success">🔔</div>
        <b>Mis notificaciones</b>
        <span class="desc">Avisos para ti</span>
      </button>
      <button class="tile" data-nav="notifications">
        <div class="ico tint-warning">📣</div>
        <b>Enviar notificaciones</b>
        <span class="desc">Mensaje a colaboradores</span>
      </button>
      <button class="tile" data-act="projects">
        <div class="ico tint-neutral">🏗️</div>
        <b>Proyectos y cargos</b>
        <span class="desc">BT y cargos</span>
      </button>
      <button class="tile" data-nav="settings">
        <div class="ico tint-neutral">⚙️</div>
        <b>Ajustes</b>
        <span class="desc">Tu perfil y la app</span>
      </button>
      <button class="tile danger" data-act="logout">
        <div class="ico tint-danger">🚪</div>
        <b>Cerrar sesión</b>
        <span class="desc">Salir de la cuenta</span>
      </button>
    </div>
  `;
  return { html, mount: (root) => {
    root.querySelector('[data-action="install"]')?.addEventListener('click', async () => { await promptInstall(); navigate('panel'); });
    root.querySelector('[data-action="ios-install"]')?.addEventListener('click', () => showIOSInstallHelp());
    root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
    root.querySelector('[data-act="projects"]').onclick = () => openProjectsMenu();
    root.querySelector('[data-act="logout"]').onclick = async () => {
      const ok = await confirmDialog({ title: 'Cerrar sesion', message: 'Volveras a la pantalla de ingreso.', confirmText: 'Cerrar sesion' });
      if (ok) { const { logout } = await import('./app.js'); await logout(); }
    };
  }};
}

// ============ PANEL DE REVISION (revisora / admin) ============
// Foco en revisar por trabajador: cada fila lleva a todo lo de esa persona,
// en vez de mezclar las boletas de todos en un solo feed. Notificar y
// avisos generales viven aparte, en la seccion de Notificaciones.
export function renderReviewerPanel() {
  const workers = controllableProfiles();
  const workerRows = workers.map((w) => {
    const t = store.totals(w.id);
    const unseen = store.getExpenses(w.id).filter((e) => !e.seen).length;
    const cargoPrefix = w.cargoId ? esc(store.cargoLabel(w.cargoId)) + ' - ' : '';
    return `<button class="item" data-open-worker="${w.id}">
      <span class="emoji">👤</span>
      <span class="body">
        <span class="t">${esc(w.fullName || w.rut)}</span>
        <span class="s">${cargoPrefix}${unseen ? unseen + ' sin ver' : 'Al dia'}</span>
      </span>
      <span class="amt mono">${formatMoney(t.availableBalance, cur())}</span>
    </button>`;
  }).join('');

  const html = `
    <div class="section-title" style="margin-bottom:4px">Colaboradores (${workers.length})</div>
    <div class="list">${workers.length ? workerRows : emptyInline('', 'Sin colaboradores aun', 'Apareceran aqui cuando se registren')}</div>
  `;
  return { html, mount: (root) => {
    root.querySelectorAll('[data-open-worker]').forEach((b) => b.onclick = () => navigate('panelWorker/' + b.dataset.openWorker));
  }};
}

// ============ DETALLE DE TRABAJADOR (vista de revisora) ============
// Todo lo de un trabajador en un solo lugar: saldo, sus rendiciones, sus
// gastos sueltos por revisar, y las acciones de edicion/notificacion/fondo.
export function renderReviewerWorkerDetail(workerId) {
  const w = store.getProfileById(workerId);
  if (!w) return { html: emptyInline('🤔', 'Colaborador no encontrado', ''), mount: () => {} };
  const t = store.totals(workerId);
  const reports = store.getReports(workerId);
  const loose = store.getUnassignedExpenses(workerId);

  const reportRows = reports.map((r) => {
    const total = store.reportTotal(r.id);
    const count = store.getReportExpenses(r.id).length;
    return `<button class="item" data-open-report="${r.id}">
      <span class="emoji">📋</span>
      <span class="body">
        <span class="t">${esc(r.title)} ${reportStatusBadge(r.status)}</span>
        <span class="s">${monthLabel(r.period)} - ${count} gasto(s)</span>
      </span>
      <span class="amt mono">${formatMoney(total, cur())}</span>
    </button>`;
  }).join('');

  const html = `
    <div class="card">
      <div class="muted tiny">${esc(w.rut)}${w.cargoId ? ' - ' + esc(store.cargoLabel(w.cargoId)) : ''}</div>
      <h2 style="margin:4px 0 10px;font-size:20px">${esc(w.fullName || w.rut)}</h2>
      <div class="balance-grid">
        <div><span>Recibido</span><b class="mono">${formatMoney(t.receivedTotal, cur())}</b></div>
        <div><span>Gastado</span><b class="mono">${formatMoney(t.spentTotal, cur())}</b></div>
      </div>
      <div class="row between" style="margin-top:10px">
        <span class="muted">Saldo disponible</span>
        <b class="mono" style="font-size:19px">${formatMoney(t.availableBalance, cur())}</b>
      </div>
    </div>

    <div class="report-actions no-print">
      <button class="btn outline" data-act="edit">Editar datos</button>
      <button class="btn outline" data-act="fund">+ Fondo</button>
      <button class="btn primary" data-act="remind">Notificar</button>
      <button class="btn outline" data-act="reset-pass">🔑 Resetear contraseña</button>
    </div>
    ${w.mustChangePassword ? `<p class="muted tiny" style="margin:-8px 2px 14px">⚠️ Contraseña reseteada, aun no la cambia</p>` : ''}
    ${w.role === 'worker' ? `<button class="btn danger no-print" data-act="delete" style="width:100%;margin-bottom:14px">🗑️ Eliminar cuenta</button>` : ''}

    <div class="section-title" style="margin-top:18px">Rendiciones (${reports.length})</div>
    <div class="list">${reports.length ? reportRows : emptyInline('', 'Sin rendiciones', 'Aun no crea ninguna')}</div>

    ${loose.length ? `
      <div class="section-title" style="margin-top:18px">Gastos sin rendicion (${loose.length})</div>
      <div class="list">${loose.map((e) => expenseItem(e)).join('')}</div>
    ` : ''}
  `;
  return { html, mount: (root) => {
    hydrateThumbs(root);
    root.querySelector('[data-act="edit"]').onclick = () => openProfileForm(workerId);
    root.querySelector('[data-act="fund"]').onclick = () => openTransferForm(null, workerId);
    root.querySelector('[data-act="remind"]').onclick = () => openNotifyWorkerForm(workerId);
    root.querySelector('[data-act="reset-pass"]').onclick = async () => {
      const ok = await confirmDialog({
        title: 'Resetear contraseña',
        message: `La contraseña de ${w.fullName || w.rut} quedara en "123456". Se le pedira cambiarla apenas entre.`,
        confirmText: 'Resetear'
      });
      if (!ok) return;
      try { await store.resetWorkerPassword(workerId); toast('Contraseña reseteada a 123456', 'ok'); navigate('panelWorker/' + workerId); }
      catch (e) { toast('No se pudo resetear: ' + (e.message || e), 'err'); }
    };
    root.querySelector('[data-act="delete"]')?.addEventListener('click', () => deleteWorkerAccountFlow(w, 'reviewQueue'));
    root.querySelectorAll('[data-open-report]').forEach((b) => b.onclick = () => navigate('panelReport/' + b.dataset.openReport));
    root.querySelectorAll('[data-action="expense"]').forEach((el) =>
      el.addEventListener('click', () => navigate('panelExpense/' + el.dataset.id)));
  }};
}

const REPORT_STATUS_LABEL = { draft: '', submitted: '🕓 Enviada', approved: '✅ Cerrada', needs_changes: '❗ Con observaciones' };
function reportStatusBadge(status) {
  return REPORT_STATUS_LABEL[status] || '';
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
    store.markExpenseSeen(id).catch(() => {});
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

  const isClosed = r.status === 'approved';

  const html = `
    <div class="card">
      <div class="muted tiny">${esc(owner?.fullName || owner?.rut || '')}</div>
      <h2 style="margin:6px 0 2px;font-size:21px">${esc(r.title)} ${reportStatusBadge(r.status)}</h2>
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
      <button class="btn ${isClosed ? 'outline' : 'primary'}" data-act="toggle-close">${isClosed ? 'Reabrir rendicion' : 'Cerrar rendicion'}</button>
    </div>
    <div class="section-title">Gastos incluidos</div>
    <div class="list">${expenses.length ? expenses.map((e) => expenseItem(e)).join('') : emptyInline('🧾', 'Sin gastos', '')}</div>
  `;
  return { html, mount: (root) => {
    hydrateThumbs(root);
    root.querySelector('[data-act="download"]')?.addEventListener('click', () => downloadRendicion(r));
    root.querySelector('[data-act="download-receipts"]')?.addEventListener('click', () => downloadReceipts(r));
    root.querySelector('[data-act="toggle-close"]')?.addEventListener('click', async () => {
      const next = isClosed ? 'draft' : 'approved';
      try {
        await store.updateReport(r.id, { status: next });
        toast(isClosed ? 'Rendicion reabierta' : 'Rendicion cerrada', 'ok');
        navigate('panelReport/' + r.id);
      } catch (e) { toast('No se pudo cambiar: ' + (e.message || e), 'err'); }
    });
    root.querySelectorAll('[data-action="expense"]').forEach((el) =>
      el.addEventListener('click', () => navigate('panelExpense/' + el.dataset.id)));
  }};
}

// ============ ADMINISTRACION (solo admin) ============
let adminAcctFilter = 'all';
function realRoleLabel(role) { return role === 'admin' ? 'Admin' : role === 'reviewer' ? 'Revisora' : 'Colaborador'; }

export function renderAdminPanel() {
  const pending = teamPendingCount();
  const allProfiles = store.getAllProfiles();
  const profiles = allProfiles.filter((p) =>
    adminAcctFilter === 'all' ? true : adminAcctFilter === 'reviewer' ? p.role === 'reviewer' : p.role === 'worker');

  const rows = profiles.map((p) => `
    <div class="acct-row">
      <div style="flex:1;min-width:0">
        <div class="nm">${esc(p.fullName || p.rut)}</div>
        <div class="muted tiny">${esc(p.rut)}${p.cargoId ? ' - ' + esc(store.cargoLabel(p.cargoId)) : ''}</div>
      </div>
      <span class="badge role-${p.role}">${realRoleLabel(p.role)}</span>
      ${p.id !== store.myUserId() ? `<button class="btn sm outline" data-more="${p.id}">⋯</button>` : '<span class="muted tiny">(tu)</span>'}
    </div>`).join('');

  const html = `
    <div class="section-title" style="margin-top:0">Accesos</div>
    <div class="tilegrid" style="margin-bottom:6px">
      <button class="tile" data-nav="reviewQueue">
        ${pending ? `<span class="count-bubble tile-count">${pending}</span>` : ''}
        <div class="ico tint-primary">🗂️</div>
        <b>Administrar rendiciones</b>
      </button>
      <button class="tile" data-nav="metrics">
        <div class="ico tint-info">📊</div>
        <b>Métricas</b>
      </button>
      <button class="tile" data-nav="notifications">
        <div class="ico tint-warning">📣</div>
        <b>Notificaciones</b>
      </button>
      <button class="tile" data-act="projects">
        <div class="ico tint-neutral">🏗️</div>
        <b>Proyectos y cargos</b>
      </button>
    </div>

    <div class="section-title">Cuentas y roles (${allProfiles.length})</div>
    <div class="chips" style="margin-bottom:10px">
      <button class="chip ${adminAcctFilter === 'all' ? 'active' : ''}" data-filter="all">Todas</button>
      <button class="chip ${adminAcctFilter === 'reviewer' ? 'active' : ''}" data-filter="reviewer">Revisoras</button>
      <button class="chip ${adminAcctFilter === 'worker' ? 'active' : ''}" data-filter="worker">Colaboradores</button>
    </div>
    ${profiles.length ? rows : emptyInline('', 'Sin cuentas en este filtro', '')}
  `;
  return { html, mount: (root) => {
    root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.nav)));
    root.querySelector('[data-act="projects"]').onclick = () => openProjectsMenu();
    root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { adminAcctFilter = b.dataset.filter; navigate('admin'); }));
    root.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => openAccountMenu(b.dataset.more));
  }};
}

async function openAccountMenu(profileId) {
  const p = store.getProfileById(profileId);
  if (!p) return;
  // "Eliminar cuenta" solo se ofrece para colaboradores: borra rendiciones,
  // gastos y boletas junto con la cuenta, asi que revisoras y admins quedan
  // fuera de esta via (deben cambiarse de rol antes, si hiciera falta).
  const options = [
    { label: 'Editar cuenta' },
    { label: 'Cambiar rol' },
    { label: 'Resetear contraseña' },
    ...(p.role === 'worker' ? [{ label: 'Eliminar cuenta', danger: true }] : [])
  ];
  const idx = await actionSheet(p.fullName || p.rut, options);
  if (idx === 0) openProfileForm(profileId);
  else if (idx === 1) await changeAccountRole(p);
  else if (idx === 2) await resetAccountPassword(p);
  else if (idx === 3) await deleteWorkerAccountFlow(p, 'admin');
}

async function changeAccountRole(p) {
  const options = [{ value: 'worker', label: 'Colaborador' }, { value: 'reviewer', label: 'Revisora' }, { value: 'admin', label: 'Admin' }]
    .filter((o) => o.value !== p.role);
  const idx = await actionSheet('Cambiar rol de ' + (p.fullName || p.rut), options.map((o) => ({ label: o.label })));
  if (idx == null) return;
  const target = options[idx];
  const ok = await confirmDialog({ title: 'Cambiar rol', message: `Se cambiara el rol de esta cuenta a "${target.label}".`, confirmText: 'Cambiar' });
  if (!ok) return;
  try { await store.setRole(p.id, target.value); toast('Rol actualizado', 'ok'); }
  catch (e) { toast('No se pudo cambiar: ' + (e.message || e), 'err'); }
}

async function resetAccountPassword(p) {
  const ok = await confirmDialog({
    title: 'Resetear contraseña',
    message: `La contraseña de ${p.fullName || p.rut} quedara en "123456". Se le pedira cambiarla apenas entre.`,
    confirmText: 'Resetear'
  });
  if (!ok) return;
  try { await store.resetWorkerPassword(p.id); toast('Contraseña reseteada a 123456', 'ok'); }
  catch (e) { toast('No se pudo resetear: ' + (e.message || e), 'err'); }
}

// Borra la cuenta y TODO su historial (rendiciones, gastos, boletas). No se
// puede deshacer, por eso la confirmacion es explicita sobre eso.
async function deleteWorkerAccountFlow(p, redirectRoute) {
  const ok = await confirmDialog({
    title: 'Eliminar cuenta',
    message: `Se eliminara la cuenta de ${p.fullName || p.rut} junto con todas sus rendiciones, gastos y boletas. Esto no se puede deshacer.`,
    confirmText: 'Eliminar todo',
    danger: true
  });
  if (!ok) return;
  try {
    await store.deleteWorkerAccount(p.id);
    toast('Cuenta eliminada', 'ok');
    navigate(redirectRoute);
  } catch (e) { toast('No se pudo eliminar: ' + (e.message || e), 'err'); }
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
