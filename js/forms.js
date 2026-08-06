// ===== Formularios (se abren en hojas inferiores) =====
import * as store from './store.js';
import * as storage from './storage.js';
import { compressImage } from './imageUtils.js';
import { openSheet, confirmDialog, actionSheet } from './ui.js';
import { esc, todayISO, CURRENCIES, toast, formatMoney, monthKey } from './utils.js';
import { navigate } from './router.js';
import { readReceipt } from './ocr.js';
import { openCropper } from './crop.js';

const DEFAULT_CURRENCY = 'CLP';

// ---------- Formulario de GASTO (crear / editar) ----------
export function openExpenseForm(expenseId = null, presetReportId = null) {
  const editing = expenseId ? store.getExpense(expenseId) : null;
  const cats = store.getCategories();
  const f = {
    amount: editing ? editing.amount : '',
    currency: editing ? editing.currency : DEFAULT_CURRENCY,
    categoryId: editing ? editing.categoryId : cats[0]?.id,
    date: editing ? editing.date : todayISO(),
    merchant: editing ? editing.merchant : '',
    paymentMethod: editing ? editing.paymentMethod : 'efectivo',
    notes: editing ? editing.notes : '',
    docType: editing ? editing.docType : 'boleta',
    docNumber: editing ? editing.docNumber : '',
    reportId: editing ? editing.reportId : presetReportId,
    btId: editing ? editing.btId : null,
    billable: editing ? editing.billable !== false : true,
    taxIncluded: editing ? editing.taxIncluded !== false : true
  };
  // Fotos del gasto: {id, path} = boleta ya subida a Storage, {blob} = nueva por subir.
  const photos = (editing?.receipts || []).map((r) => ({ id: r.id, path: r.path }));
  const removeReceiptIds = [];

  const currencyOpts = Object.entries(CURRENCIES)
    .map(([code, c]) => `<option value="${code}" ${f.currency === code ? 'selected' : ''}>${code} - ${c.name}</option>`).join('');
  const catGrid = cats.map((c) =>
    `<button type="button" class="cat-pick ${f.categoryId === c.id ? 'active' : ''}" data-cat="${c.id}">
       <span class="e">${esc(c.emoji || '')}</span><span>${esc(c.name)}</span>
     </button>`).join('');
  const reports = store.getReports();
  const reportOpts = `<option value="">- Sin asignar -</option>` + reports.map((r) =>
    `<option value="${r.id}" ${f.reportId === r.id ? 'selected' : ''}>${esc(r.title)}</option>`).join('');
  const bts = store.getBTs();
  const btOpts = `<option value="">- Sin BT -</option>` + bts.map((b) =>
    `<option value="${b.id}" ${f.btId === b.id ? 'selected' : ''}>${esc(b.code)}${b.name ? ' - ' + esc(b.name) : ''}</option>`).join('');

  const reviewBadge = editing && editing.reviewStatus && editing.reviewStatus !== 'pending'
    ? `<div class="card tight" style="margin-bottom:12px">${reviewStatusLine(editing)}</div>` : '';

  const html = `
    <div class="sheet-head"><h2>${editing ? 'Editar gasto' : 'Nuevo gasto'}</h2><button class="x" data-close>x</button></div>
    ${reviewBadge}

    <div class="field first-photo">
      <label>1. Foto de boleta o factura</label>
      <div id="photoArea"></div>
      <div id="ocrBox"></div>
      <input type="file" accept="image/*" capture="environment" id="photoInput" hidden />
      <input type="file" accept="image/*" id="galleryInput" hidden />
      <div class="help">Toma la foto con la camara o sube una que ya tengas en el celular. La app intentara completar los datos y luego puedes corregirlos.</div>
    </div>

    <div class="amount-wrap">
      <span class="cur" id="curSym">${CURRENCIES[f.currency].symbol}</span>
      <input class="input-amount" id="amount" inputmode="decimal" placeholder="0" value="${f.amount || ''}" />
    </div>

    <div class="grid-2">
      <div class="field"><label>Fecha</label><input type="date" class="input" id="date" value="${f.date}" max="${todayISO()}" /></div>
      <div class="field"><label>Moneda</label><select class="select" id="currency">${currencyOpts}</select></div>
    </div>

    <div class="field"><label>Comercio / proveedor</label><input class="input" id="merchant" placeholder="Ej: Copec, ferreteria, restaurant" value="${esc(f.merchant)}" /></div>

    <div class="grid-2">
      <div class="field"><label>Documento</label><select class="select" id="docType"><option value="boleta" ${f.docType === 'boleta' ? 'selected' : ''}>Boleta</option><option value="factura" ${f.docType === 'factura' ? 'selected' : ''}>Factura</option></select></div>
      <div class="field"><label>N documento</label><input class="input" id="docNumber" inputmode="numeric" placeholder="Ej: 055969" value="${esc(f.docNumber)}" /></div>
    </div>

    <div class="field"><label>Categoria</label><div class="cat-grid" id="catGrid">${catGrid}</div></div>
    <div class="field"><label>BT / Proyecto</label><select class="select" id="bt">${btOpts}</select>${bts.length ? '' : '<div class="help">Aun no hay BT creadas. Pidele a la administradora que agregue una.</div>'}</div>
    <div class="field"><label>Asignar a rendicion</label><select class="select" id="report">${reportOpts}</select></div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="notes" placeholder="Detalle u observaciones">${esc(f.notes)}</textarea></div>

    <div class="btn-row">
      ${editing ? `<button class="btn danger" data-del>Eliminar</button>` : ''}
      <button class="btn primary" data-save>${editing ? 'Guardar cambios' : 'Guardar gasto'}</button>
    </div>
  `;

  openSheet(html, { full: true, onMount: async (root, close) => {
    const $ = (s) => root.querySelector(s);
    const photoArea = $('#photoArea');
    const photoInput = $('#photoInput');
    const galleryInput = $('#galleryInput');
    const ocrBox = $('#ocrBox');

    function setCategory(catId) {
      if (!store.getCategories().some((c) => c.id === catId)) return;
      f.categoryId = catId;
      root.querySelectorAll('.cat-pick').forEach((b) => b.classList.toggle('active', b.dataset.cat === catId));
    }
    function applyOcrData(data) {
      if (!data) return;
      if (data.amount) $('#amount').value = data.amount;
      if (data.date) $('#date').value = data.date;
      if (data.merchant) $('#merchant').value = data.merchant;
      if (data.docType) $('#docType').value = data.docType;
      if (data.docNumber) $('#docNumber').value = data.docNumber;
      if (data.categoryId) setCategory(data.categoryId);
    }
    async function runOcr(blob) {
      ocrBox.innerHTML = '<div class="ocr-card"><b>Leyendo boleta...</b><span>La primera vez puede tardar un poco.</span></div>';
      try {
        const data = await readReceipt(blob, (p) => {
          const label = typeof p === 'number' ? `Leyendo texto ${p}%` : String(p);
          ocrBox.innerHTML = `<div class="ocr-card"><b>${esc(label)}</b><span>Los datos se pueden corregir antes de guardar.</span></div>`;
        });
        applyOcrData(data);
        const found = [data.amount ? `Monto ${formatMoney(data.amount, $('#currency').value)}` : '', data.docNumber ? `Doc ${esc(data.docNumber)}` : '', data.date ? `Fecha ${esc(data.date)}` : ''].filter(Boolean).join(' - ');
        const missing = [!data.amount ? 'monto' : '', !data.date ? 'FECHA (quedo la de hoy)' : '', !data.docNumber ? 'N documento' : ''].filter(Boolean).join(', ');
        const warn = missing ? `<span style="color:var(--danger,#b00)">No se detecto: ${missing}. Revisalo antes de guardar.</span>` : '';
        ocrBox.innerHTML = `<div class="ocr-card ok"><b>Datos leidos automaticamente</b><span>${found || 'Revisa y completa los campos faltantes.'}</span>${warn}<details><summary>Ver texto detectado</summary><pre>${esc(data.rawText || '')}</pre></details></div>`;
      } catch (e) {
        ocrBox.innerHTML = '<div class="ocr-card warn"><b>No pude leer la boleta</b><span>Completa los datos manualmente. La foto igual queda guardada.</span></div>';
      }
    }
    async function renderPhotos() {
      let tiles = '';
      for (let i = 0; i < photos.length; i++) {
        const ph = photos[i];
        if (!ph.url) ph.url = ph.blob ? URL.createObjectURL(ph.blob) : await storage.getReceiptUrl(ph.path);
        if (ph.url) tiles += `<div class="photo-preview"><img src="${ph.url}" alt="boleta ${i + 1}"/><button class="rm" data-rmphoto="${i}">x</button></div>`;
      }
      photoArea.innerHTML = `
        ${tiles ? `<div class="grid-2" style="margin-bottom:8px">${tiles}</div>` : ''}
        <div class="grid-2">
          <button type="button" class="photo-drop" data-takephoto><b>📷 ${photos.length ? 'Otra foto' : 'Tomar foto'}</b><span>Camara</span></button>
          <button type="button" class="photo-drop" data-uploadphoto><b>🖼️ Subir foto</b><span>Galeria del celular</span></button>
        </div>`;
      photoArea.querySelectorAll('[data-rmphoto]').forEach((b) => b.onclick = () => {
        const i = Number(b.dataset.rmphoto);
        const ph = photos[i];
        if (ph.id) removeReceiptIds.push(ph.id);
        if (ph.url && ph.blob) URL.revokeObjectURL(ph.url);
        photos.splice(i, 1);
        renderPhotos();
      });
      photoArea.querySelector('[data-takephoto]').onclick = () => photoInput.click();
      photoArea.querySelector('[data-uploadphoto]').onclick = () => galleryInput.click();
    }
    const handleFile = async (file) => {
      if (!file) return;
      try {
        const chosen = await openCropper(file);
        if (!chosen) return;
        toast('Procesando imagen...');
        const blob = await compressImage(chosen);
        const isFirst = photos.length === 0;
        photos.push({ blob });
        await renderPhotos();
        if (isFirst) runOcr(chosen);
      } catch (e) { toast('No se pudo cargar la imagen', 'err'); }
    };
    photoInput.onchange = () => { handleFile(photoInput.files[0]); photoInput.value = ''; };
    galleryInput.onchange = () => { handleFile(galleryInput.files[0]); galleryInput.value = ''; };
    renderPhotos();

    $('#catGrid').addEventListener('click', (e) => { const btn = e.target.closest('[data-cat]'); if (btn) setCategory(btn.dataset.cat); });
    $('#currency').addEventListener('change', (e) => { f.currency = e.target.value; $('#curSym').textContent = CURRENCIES[f.currency].symbol; });
    $('[data-close]').onclick = () => close();
    $('[data-save]').onclick = async () => {
      const amount = parseFloat(String($('#amount').value).replace(',', '.'));
      if (!amount || amount <= 0) { toast('Ingresa un monto valido', 'err'); return; }
      const payload = { amount, currency: $('#currency').value, categoryId: f.categoryId, date: $('#date').value || todayISO(), merchant: $('#merchant').value.trim(), docType: $('#docType').value, docNumber: $('#docNumber').value.trim(), notes: $('#notes').value.trim(), reportId: $('#report').value || null, btId: $('#bt').value || null };

      // Aviso de posible duplicado (mismo N doc, o mismo monto + fecha), entre CUALQUIER trabajador.
      const btn = $('[data-save]'); btn.disabled = true;
      let dup = null;
      try { dup = await store.findDuplicate(payload); } catch (e) { /* si falla, seguimos igual */ }
      if (dup && dup.found) {
        btn.disabled = false;
        const ok = await confirmDialog({
          title: 'Posible duplicado',
          message: `Ya existe un gasto de ${formatMoney(dup.amount, 'CLP')} del ${dup.date} (${dup.merchant || 'sin comercio'}). Podria ser tuyo o de otro trabajador. Guardar de todas formas?`,
          confirmText: 'Guardar igual'
        });
        if (!ok) return;
        btn.disabled = true;
      }

      try {
        payload.pendingBlobs = photos.filter((p) => p.blob).map((p) => p.blob);
        if (editing) {
          payload.newBlobs = payload.pendingBlobs; delete payload.pendingBlobs;
          payload.removeReceiptIds = removeReceiptIds;
          await store.updateExpense(editing.id, payload);
          toast('Gasto actualizado', 'ok');
        } else {
          await store.addExpense(store.myUserId(), payload);
          toast('Gasto guardado', 'ok');
        }
        close();
      } catch (e) {
        btn.disabled = false;
        toast('No se pudo guardar: ' + (e.message || e), 'err');
      }
    };
    if (editing) {
      $('[data-del]').onclick = async () => {
        const ok = await confirmDialog({ title: 'Eliminar gasto', message: 'Seguro que quieres eliminar este gasto? No se puede deshacer.', confirmText: 'Eliminar', danger: true });
        if (ok) { await store.deleteExpense(editing.id); toast('Gasto eliminado'); close(); navigate('expenses'); }
      };
    }
  }});
}

function reviewStatusLine(e) {
  const map = {
    approved: ['✅', 'Aprobado por la revisora'],
    adjusted: ['✏️', `Ajustado por la revisora a ${formatMoney(e.approvedAmount, e.currency)}`],
    objected: ['❌', 'Objetado por la revisora'],
    clarification_requested: ['❓', 'La revisora pidio una aclaracion']
  };
  const [icon, label] = map[e.reviewStatus] || ['', ''];
  return `<b>${icon} ${esc(label)}</b>${e.reviewerComment ? `<div class="muted tiny" style="margin-top:4px">"${esc(e.reviewerComment)}"</div>` : ''}`;
}

// ---------- Formulario de RENDICION ----------
export function openReportForm(reportId = null) {
  const editing = reportId ? store.getReport(reportId) : null;
  const period = editing ? editing.period : monthKey(todayISO());
  const autoOpening = editing ? store.reportBalance(editing.id).opening : store.availableForNewReport();
  const saldoIniVal = (editing && editing.saldoInicial != null) ? editing.saldoInicial : '';
  const html = `
    <div class="sheet-head">
      <h2>${editing ? 'Editar rendicion' : 'Nueva rendicion'}</h2>
      <button class="x" data-close>x</button>
    </div>
    <div class="field">
      <label>Titulo de la rendicion</label>
      <input class="input" id="title" placeholder="Ej: Rendicion Mayo - Varios Proyectos" value="${esc(editing ? editing.title : '')}" />
    </div>
    <div class="grid-2">
      <div class="field">
        <label>N Rendicion</label>
        <input class="input" id="rend" placeholder="Ej: 206" value="${esc(editing ? editing.rendNumber : '')}" />
      </div>
      <div class="field">
        <label>Periodo</label>
        <input type="month" class="input" id="period" value="${period}" />
      </div>
    </div>
    <div class="field">
      <label>Obra</label>
      <input class="input" id="obra" placeholder="Nombre de la obra / proyecto" value="${esc(editing ? editing.obra : '')}" />
    </div>
    <div class="field">
      <label>Monto asignado (saldo inicial)</label>
      <input class="input" id="saldoIni" inputmode="numeric" placeholder="Auto: ${formatMoney(autoOpening, 'CLP')}" value="${saldoIniVal}" />
      <div class="help">En blanco usa el saldo disponible automatico (lo que quedo de la rendicion anterior). Escribe un monto solo si necesitas ajustarlo.</div>
    </div>
    <div class="field">
      <label>Descripcion / observaciones</label>
      <textarea class="textarea" id="desc" placeholder="Detalle de la rendicion de gastos">${esc(editing ? editing.description : '')}</textarea>
    </div>
    <button class="btn primary" data-save>${editing ? 'Guardar' : 'Crear rendicion'}</button>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-save]').onclick = async () => {
      const title = root.querySelector('#title').value.trim();
      if (!title) { toast('Ponle un titulo a la rendicion', 'err'); return; }
      const rawSaldo = root.querySelector('#saldoIni').value.trim();
      const payload = {
        title,
        period: root.querySelector('#period').value,
        description: root.querySelector('#desc').value.trim(),
        obra: root.querySelector('#obra').value.trim(),
        rendNumber: root.querySelector('#rend').value.trim(),
        saldoInicial: rawSaldo === '' ? null : (parseFloat(rawSaldo.replace(/[^\d.-]/g, '')) || 0)
      };
      try {
        if (editing) {
          await store.updateReport(editing.id, payload);
          toast('Rendicion actualizada', 'ok'); close();
        } else {
          const newId = await store.addReport(store.myUserId(), payload);
          toast('Rendicion creada', 'ok'); close(); navigate('report/' + newId);
        }
      } catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err'); }
    };
  }});
}

// ---------- Asignar gastos a una rendicion (seleccion multiple) ----------
export function openAssignExpenses(reportId) {
  const unassigned = store.getUnassignedExpenses();
  if (!unassigned.length) { toast('No hay gastos sin asignar'); return; }
  const rows = unassigned.map((e) => {
    const c = store.getCategory(e.categoryId);
    return `<label class="manage-row">
      <input type="checkbox" data-eid="${e.id}" style="width:20px;height:20px"/>
      <span class="e">${c.emoji}</span>
      <span class="nm">${esc(e.merchant || c.name)}<br><span class="muted tiny">${e.date}</span></span>
      <b class="mono">${formatMoney(e.amount, e.currency)}</b>
    </label>`;
  }).join('');
  const html = `
    <div class="sheet-head"><h2>Agregar gastos</h2><button class="x" data-close>x</button></div>
    <p class="muted tiny" style="margin-top:-6px">Selecciona los gastos a incluir en la rendicion.</p>
    <div style="max-height:55vh;overflow:auto">${rows}</div>
    <button class="btn primary" data-save style="margin-top:14px">Agregar seleccionados</button>
  `;
  openSheet(html, { full: true, onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-save]').onclick = async () => {
      const ids = Array.from(root.querySelectorAll('[data-eid]:checked')).map((c) => c.dataset.eid);
      if (!ids.length) { toast('No seleccionaste gastos', 'err'); return; }
      for (const id of ids) await store.assignToReport(id, reportId);
      toast(`${ids.length} gasto(s) agregados`, 'ok');
      close();
    };
  }});
}

// ---------- Perfil (nombre): el propio, o el de un trabajador si es revisora/admin ----------
export function openProfileForm(userId = null) {
  const editingOther = userId && userId !== store.myUserId();
  const canEditCargo = editingOther && store.isReviewerOrAdmin();
  const p = editingOther ? store.getProfileById(userId) : store.getProfile();
  const cargoOpts = ['<option value="">Sin cargo</option>'].concat(
    store.CARGOS.map((c) => `<option value="${esc(c)}" ${p?.cargo === c ? 'selected' : ''}>${esc(c)}</option>`)
  ).join('');
  const html = `
    <div class="sheet-head"><h2>${editingOther ? 'Editar trabajador' : 'Mi perfil'}</h2><button class="x" data-close>x</button></div>
    <div class="field"><label>Nombre</label><input class="input" id="name" value="${esc(p?.fullName || '')}"/></div>
    <div class="field"><label>RUT</label><input class="input" value="${esc(p?.rut || '')}" disabled/></div>
    <div class="field"><label>Rol</label><input class="input" value="${roleLabel(p?.role)}" disabled/></div>
    <div class="field">
      <label>Cargo en la empresa</label>
      ${canEditCargo
        ? `<select class="select" id="cargo">${cargoOpts}</select>`
        : `<input class="input" value="${esc(p?.cargo || 'Sin cargo')}" disabled/>`}
    </div>
    <button class="btn primary" data-save>Guardar</button>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-save]').onclick = async () => {
      const name = root.querySelector('#name').value.trim();
      if (!name) { toast('Ingresa un nombre', 'err'); return; }
      const cargo = canEditCargo ? root.querySelector('#cargo').value : undefined;
      try { await store.updateProfileDetails(p.id, { fullName: name, cargo }); toast('Perfil actualizado', 'ok'); close(); }
      catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err'); }
    };
  }});
}
function roleLabel(role) {
  return role === 'admin' ? 'Administrador' : role === 'reviewer' ? 'Revisora' : 'Trabajador';
}

// ---------- Formulario de BT / Proyecto (solo admin) ----------
export function openBTForm(btId = null) {
  const editing = btId ? store.getBT(btId) : null;
  const html = `
    <div class="sheet-head"><h2>${editing ? 'Editar BT' : 'Nueva BT / Proyecto'}</h2><button class="x" data-close>x</button></div>
    <div class="field"><label>Codigo BT</label><input class="input" id="code" placeholder="Ej: BT-141" value="${esc(editing ? editing.code : '')}"/></div>
    <div class="field"><label>Nombre / Obra</label><input class="input" id="name" placeholder="Ej: Varios Proyectos" value="${esc(editing ? editing.name : '')}"/></div>
    <button class="btn primary" data-save>${editing ? 'Guardar' : 'Crear'}</button>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-save]').onclick = async () => {
      const code = root.querySelector('#code').value.trim();
      const name = root.querySelector('#name').value.trim();
      if (!code) { toast('Ingresa el codigo de la BT', 'err'); return; }
      try {
        if (editing) await store.updateBT(editing.id, { code, name });
        else await store.addBT({ code, name });
        toast('BT guardada', 'ok'); close();
      } catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err'); }
    };
  }});
}

// ---------- Transferencia recibida (dueño, o revisora/admin para cualquiera) ----------
export function openTransferForm(transferId = null, targetOwnerId = null) {
  const editing = transferId ? store.getTransfers(targetOwnerId || store.myUserId()).find((t) => t.id === transferId) : null;
  const ownerId = targetOwnerId || (editing ? editing.ownerId : store.myUserId());
  const currencyOpts = Object.entries(CURRENCIES)
    .map(([code, c]) => `<option value="${code}" ${(editing?.currency || DEFAULT_CURRENCY) === code ? 'selected' : ''}>${code} - ${c.name}</option>`)
    .join('');
  const ownerName = ownerId === store.myUserId() ? '' : (store.getProfileById(ownerId)?.fullName || '');
  const html = `
    <div class="sheet-head"><h2>${editing ? 'Editar transferencia' : 'Transferencia recibida'}</h2><button class="x" data-close>x</button></div>
    ${ownerName ? `<p class="muted tiny" style="margin-top:-6px">Para: <b>${esc(ownerName)}</b></p>` : ''}
    <div class="amount-wrap">
      <span class="cur" id="curSym">${CURRENCIES[editing?.currency || DEFAULT_CURRENCY].symbol}</span>
      <input class="input-amount" id="amount" inputmode="numeric" placeholder="0" value="${editing ? editing.amount : ''}" />
    </div>
    <div class="grid-2">
      <div class="field"><label>Fecha</label><input type="date" class="input" id="date" value="${editing?.date || todayISO()}" /></div>
      <div class="field"><label>Moneda</label><select class="select" id="currency">${currencyOpts}</select></div>
    </div>
    <div class="field"><label>Nota</label><input class="input" id="note" placeholder="Ej: Transferencia inicial, caja chica..." value="${esc(editing?.note || '')}" /></div>
    <div class="btn-row">
      ${editing ? '<button class="btn danger" data-del>Eliminar</button>' : ''}
      <button class="btn primary" data-save>${editing ? 'Guardar' : 'Registrar transferencia'}</button>
    </div>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('#currency').onchange = (e) => { root.querySelector('#curSym').textContent = CURRENCIES[e.target.value].symbol; };
    root.querySelector('[data-save]').onclick = async () => {
      const amount = parseFloat(String(root.querySelector('#amount').value).replace(/[^\d,.-]/g, '').replace(',', '.'));
      if (!amount || amount <= 0) { toast('Ingresa un monto valido', 'err'); return; }
      const payload = {
        amount, currency: root.querySelector('#currency').value,
        date: root.querySelector('#date').value || todayISO(),
        note: root.querySelector('#note').value.trim()
      };
      try {
        if (editing) await store.updateTransfer(editing.id, payload);
        else await store.addTransfer(ownerId, payload);
        toast('Transferencia guardada', 'ok'); close();
      } catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err'); }
    };
    root.querySelector('[data-del]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Eliminar transferencia', message: 'Esto cambiara el saldo disponible.', confirmText: 'Eliminar', danger: true });
      if (ok) { await store.deleteTransfer(editing.id); toast('Transferencia eliminada'); close(); }
    });
  }});
}

// ---------- Revision de un gasto (revisora/admin): aprobar, ajustar, objetar, pedir aclaracion ----------
export function openReviewForm(expenseId) {
  const e = store.getExpense(expenseId);
  if (!e) return;
  const html = `
    <div class="sheet-head"><h2>Revisar gasto</h2><button class="x" data-close>x</button></div>
    <div class="card tight" style="margin-bottom:14px">
      <div class="row between"><span class="muted">Monto original</span><b class="mono">${formatMoney(e.amount, e.currency)}</b></div>
      <div class="muted tiny" style="margin-top:4px">${esc(e.merchant || '')} - ${e.date}</div>
    </div>
    <div class="field" id="adjustField" style="display:none">
      <label>Monto aprobado (ajustado)</label>
      <input class="input" id="approvedAmount" inputmode="numeric" placeholder="0" value="${e.approvedAmount ?? ''}" />
    </div>
    <div class="field">
      <label>Comentario (se lo notificamos al trabajador)</label>
      <textarea class="textarea" id="comment" placeholder="Ej: falta el detalle de la boleta...">${esc(e.reviewerComment || '')}</textarea>
    </div>
    <div class="btn-row" style="flex-wrap:wrap;gap:8px">
      <button class="btn success" data-act="approved">✅ Aprobar</button>
      <button class="btn outline" data-act="adjusted">✏️ Ajustar monto</button>
      <button class="btn danger" data-act="objected">❌ Objetar</button>
      <button class="btn outline" data-act="clarification_requested">❓ Pedir aclaracion</button>
    </div>
    <button class="btn outline" data-act="send_for_approval" style="width:100%;margin-top:10px">📤 Enviar a aprobacion de otra persona</button>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelectorAll('[data-act]').forEach((btn) => btn.onclick = async () => {
      const status = btn.dataset.act;

      if (status === 'send_for_approval') {
        const candidates = store.getAllProfiles().filter((p) => p.id !== store.myUserId());
        const idx = await actionSheet('Enviar a aprobacion de...', candidates.map((p) => ({ label: p.fullName || p.rut })));
        if (idx == null) return;
        const target = candidates[idx];
        const note = root.querySelector('#comment').value.trim();
        try {
          await store.sendApprovalRequest(expenseId, target.id, note);
          await sendApprovalRequestPush(target.id, e, note);
          toast('Enviado a aprobacion de ' + (target.fullName || target.rut), 'ok');
          close();
        } catch (err) { toast('No se pudo enviar: ' + (err.message || err), 'err'); }
        return;
      }

      if (status === 'adjusted') {
        root.querySelector('#adjustField').style.display = '';
        const val = root.querySelector('#approvedAmount').value.trim();
        if (!val) { toast('Ingresa el monto aprobado', 'err'); return; }
      }
      const comment = root.querySelector('#comment').value.trim();
      const approvedAmount = status === 'adjusted' ? (parseFloat(root.querySelector('#approvedAmount').value) || 0) : null;
      try {
        await store.reviewExpense(expenseId, { status, approvedAmount, comment });
        const label = { approved: 'aprobado', adjusted: 'ajustado', objected: 'objetado', clarification_requested: 'marcado para aclaracion' }[status];
        await notifyWorkerOfReview(e, status, comment);
        toast(`Gasto ${label}`, 'ok');
        close();
      } catch (err) { toast('No se pudo guardar: ' + (err.message || err), 'err'); }
    });
  }});
}

async function sendApprovalRequestPush(toUserId, expense, note) {
  try {
    const { sendPush } = await import('./push.js');
    await sendPush({
      recipientId: toUserId, title: 'Solicitud de aprobacion',
      body: `Te piden aprobar un gasto de ${formatMoney(expense.amount, expense.currency)} (${expense.merchant || ''}).${note ? ' ' + note : ''}`,
      type: 'approval_request'
    });
  } catch (e) { /* se puede revisar igual desde el panel de notificaciones */ }
}

// ---------- Resolver una solicitud de aprobacion delegada (desde el panel de notificaciones) ----------
export function openResolveApprovalForm(request) {
  const e = store.getExpense(request.expenseId);
  if (!e) return;
  const requester = store.getProfileById(request.requestedBy);
  const owner = store.getProfileById(e.ownerId);
  const html = `
    <div class="sheet-head"><h2>Aprobar gasto</h2><button class="x" data-close>x</button></div>
    <div class="card tight" style="margin-bottom:14px">
      <div class="row between"><span class="muted">Monto original</span><b class="mono">${formatMoney(e.amount, e.currency)}</b></div>
      <div class="muted tiny" style="margin-top:4px">${esc(e.merchant || '')} - ${e.date}</div>
      <div class="muted tiny" style="margin-top:4px">Trabajador: ${esc(owner?.fullName || owner?.rut || '')}</div>
      <div class="muted tiny" style="margin-top:4px">Pedido por: ${esc(requester?.fullName || requester?.rut || '')}</div>
      ${request.note ? `<div class="muted tiny" style="margin-top:4px">"${esc(request.note)}"</div>` : ''}
    </div>
    <div class="field" id="adjustField" style="display:none">
      <label>Monto aprobado (ajustado)</label>
      <input class="input" id="approvedAmount" inputmode="numeric" placeholder="0" />
    </div>
    <div class="field">
      <label>Comentario (opcional)</label>
      <textarea class="textarea" id="comment" placeholder="Ej: todo en orden..."></textarea>
    </div>
    <div class="btn-row" style="flex-wrap:wrap;gap:8px">
      <button class="btn success" data-act="approve">✅ Aprobar</button>
      <button class="btn outline" data-act="adjust">✏️ Aprobar con ajuste</button>
      <button class="btn danger" data-act="reject">❌ Rechazar</button>
    </div>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelectorAll('[data-act]').forEach((btn) => btn.onclick = async () => {
      const act = btn.dataset.act;
      if (act === 'adjust' && root.querySelector('#adjustField').style.display === 'none') {
        root.querySelector('#adjustField').style.display = '';
        return;
      }
      const resolutionNote = root.querySelector('#comment').value.trim();
      const approve = act !== 'reject';
      const approvedAmount = act === 'adjust' ? (parseFloat(root.querySelector('#approvedAmount').value) || 0) : null;
      if (act === 'adjust' && !root.querySelector('#approvedAmount').value.trim()) { toast('Ingresa el monto aprobado', 'err'); return; }
      try {
        await store.resolveApprovalRequest(request.id, { approve, approvedAmount, resolutionNote });
        await notifyWorkerOfReview(e, approve ? (approvedAmount != null ? 'adjusted' : 'approved') : 'objected', resolutionNote);
        await notifyRequesterOfResolution(request, approve, resolutionNote);
        toast(approve ? 'Gasto aprobado' : 'Gasto rechazado', 'ok');
        close();
      } catch (err) { toast('No se pudo guardar: ' + (err.message || err), 'err'); }
    });
  }});
}

async function notifyRequesterOfResolution(request, approve, note) {
  const e = store.getExpense(request.expenseId);
  const title = approve ? 'Aprobacion resuelta' : 'Solicitud rechazada';
  const body = `${e?.merchant || 'El gasto'} que enviaste a aprobacion fue ${approve ? 'aprobado' : 'rechazado'}.${note ? ' ' + note : ''}`;
  try {
    const { sendPush } = await import('./push.js');
    await sendPush({ recipientId: request.requestedBy, title, body, type: 'manual' });
  } catch (err) { /* se puede ver igual en el panel de notificaciones */ }
}

async function notifyWorkerOfReview(expense, status, comment) {
  const map = {
    approved: ['Gasto aprobado', `Tu gasto de ${formatMoney(expense.amount, expense.currency)} (${expense.merchant || ''}) fue aprobado.`, null],
    adjusted: ['Gasto ajustado', `Se ajusto el monto de tu gasto (${expense.merchant || ''}). ${comment || ''}`.trim(), 'objected'],
    objected: ['Boleta objetada', `Se objeto tu gasto de ${formatMoney(expense.amount, expense.currency)} (${expense.merchant || ''}). ${comment || ''}`.trim(), 'objected'],
    clarification_requested: ['Aclaracion solicitada', `La revisora pide aclarar tu gasto (${expense.merchant || ''}). ${comment || ''}`.trim(), 'clarification_requested']
  };
  const [title, body] = map[status] || [null, null];
  if (!title) return;
  const type = status === 'approved' || status === 'adjusted' ? (status === 'adjusted' ? 'objected' : null) : status;
  if (!type && status !== 'approved') return;
  try {
    const { sendPush } = await import('./push.js');
    await sendPush({ recipientId: expense.ownerId, title, body, type: type || 'manual_reminder' });
  } catch (e) { /* si no tiene suscripcion push, no pasa nada grave */ }
}

// ---------- Recordatorio manual (revisora/admin) ----------
export async function sendManualReminder(ownerId, kind = 'manual_reminder') {
  const worker = store.getProfileById(ownerId);
  const title = kind === 'closure_reminder' ? 'Cierra tu rendicion' : 'Recuerda subir tus boletas';
  const body = kind === 'closure_reminder'
    ? 'La revisora te pide cerrar y enviar tu rendicion pendiente.'
    : 'Llevas un tiempo sin registrar gastos. Sube tus boletas cuando puedas.';
  try {
    const { sendPush } = await import('./push.js');
    const res = await sendPush({ recipientId: ownerId, title, body, type: kind });
    if (res.sent > 0) {
      toast(`Recordatorio enviado a ${worker?.fullName || 'el trabajador'}`, 'ok');
    } else {
      toast('No llego: ' + (res.errors?.[0] || 'sin suscripciones activas'), 'err');
    }
  } catch (e) {
    toast('No se pudo enviar: ' + (e.message || e), 'err');
  }
}

// ---------- Aviso a trabajadores elegidos, o a todos (revisora/admin) ----------
export function openBroadcastForm() {
  const workers = store.getAllProfiles().filter((p) =>
    (p.role === 'worker' || p.role === 'admin') && p.id !== store.myUserId());
  const rows = workers.map((w) =>
    `<label class="manage-row">
      <input type="checkbox" data-wid="${w.id}" checked style="width:20px;height:20px"/>
      <span class="nm">${esc(w.fullName || w.rut)}</span>
    </label>`).join('');
  const html = `
    <div class="sheet-head"><h2>Notificar trabajadores</h2><button class="x" data-close>x</button></div>
    <div class="field"><label>Titulo</label><input class="input" id="btitle" placeholder="Ej: Cierre de mes" /></div>
    <div class="field"><label>Mensaje</label><textarea class="textarea" id="bbody" placeholder="Detalle del aviso"></textarea></div>
    <div class="row between" style="margin:10px 2px 4px">
      <label>Destinatarios</label>
      <button type="button" class="mini-link" data-toggle-all>Marcar/desmarcar todos</button>
    </div>
    <div style="max-height:40vh;overflow:auto">${rows || '<p class="muted center">Sin trabajadores</p>'}</div>
    <button class="btn primary" data-save style="margin-top:14px">Enviar</button>
  `;
  openSheet(html, { full: true, onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-toggle-all]').onclick = () => {
      const boxes = Array.from(root.querySelectorAll('[data-wid]'));
      const allChecked = boxes.every((b) => b.checked);
      boxes.forEach((b) => { b.checked = !allChecked; });
    };
    root.querySelector('[data-save]').onclick = async () => {
      const title = root.querySelector('#btitle').value.trim();
      const body = root.querySelector('#bbody').value.trim();
      const recipientIds = Array.from(root.querySelectorAll('[data-wid]:checked')).map((c) => c.dataset.wid);
      if (!title) { toast('Ingresa un titulo', 'err'); return; }
      if (!recipientIds.length) { toast('Elige al menos un trabajador', 'err'); return; }
      const btn = root.querySelector('[data-save]'); btn.disabled = true;
      try {
        const { sendPush } = await import('./push.js');
        const res = await sendPush({ recipientIds, title, body, type: 'broadcast' });
        if (res.notified > 0) {
          toast(`Enviado a ${res.notified} de ${res.workers || recipientIds.length} trabajador(es)`, 'ok');
          close();
        } else {
          btn.disabled = false;
          toast('No llego a nadie: ' + (res.errors?.[0] || 'sin suscripciones activas'), 'err');
        }
      } catch (e) {
        btn.disabled = false;
        toast('No se pudo enviar: ' + (e.message || e), 'err');
      }
    };
  }});
}

// ---------- Notificar a un trabajador puntual, con mensaje propio (revisora/admin) ----------
export function openNotifyWorkerForm(userId) {
  const worker = store.getProfileById(userId);
  const html = `
    <div class="sheet-head"><h2>Notificar a ${esc(worker?.fullName || worker?.rut || '')}</h2><button class="x" data-close>x</button></div>
    <div class="field"><label>Titulo</label><input class="input" id="ntitle" placeholder="Ej: Falta una boleta" /></div>
    <div class="field"><label>Mensaje</label><textarea class="textarea" id="nbody" placeholder="Escribe el mensaje..."></textarea></div>
    <button class="btn primary" data-save style="width:100%;margin-top:14px">Enviar</button>
  `;
  openSheet(html, { onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    root.querySelector('[data-save]').onclick = async () => {
      const title = root.querySelector('#ntitle').value.trim();
      const body = root.querySelector('#nbody').value.trim();
      if (!title) { toast('Ingresa un titulo', 'err'); return; }
      const btn = root.querySelector('[data-save]'); btn.disabled = true;
      try {
        const { sendPush } = await import('./push.js');
        const res = await sendPush({ recipientId: userId, title, body, type: 'manual' });
        if (res.sent > 0) {
          toast(`Enviado a ${worker?.fullName || 'el trabajador'}`, 'ok');
          close();
        } else {
          btn.disabled = false;
          toast('No llego: ' + (res.errors?.[0] || 'sin suscripciones activas'), 'err');
        }
      } catch (e) {
        btn.disabled = false;
        toast('No se pudo enviar: ' + (e.message || e), 'err');
      }
    };
  }});
}

// ---------- Importar respaldo de Rendiciones App (herramienta de migracion) ----------
export function openImportBackupForm() {
  let file = null;

  const html = `
    <div class="sheet-head"><h2>Importar respaldo</h2><button class="x" data-close>x</button></div>
    <p class="muted" style="margin-top:-4px">Elige el archivo de respaldo (.json) que exporta Rendiciones App. Se importara a tu propia cuenta: tus rendiciones, fondos, gastos y boletas.</p>
    <input type="file" accept=".json,application/json" id="backupInput" hidden />
    <button type="button" class="btn outline" data-pick style="width:100%;margin-top:10px">Elegir archivo</button>
    <p class="muted tiny" id="fileName" style="margin-top:8px"></p>
    <div id="importStatus" class="muted tiny" style="margin-top:10px"></div>
    <button class="btn primary" data-save style="width:100%;margin-top:14px" disabled>Importar</button>
  `;
  openSheet(html, { full: true, dismissible: false, onMount: (root, close) => {
    root.querySelector('[data-close]').onclick = () => close();
    const input = root.querySelector('#backupInput');
    const nameEl = root.querySelector('#fileName');
    const statusEl = root.querySelector('#importStatus');
    const saveBtn = root.querySelector('[data-save]');

    root.querySelector('[data-pick]').onclick = () => input.click();
    input.onchange = () => {
      file = input.files[0] || null;
      nameEl.textContent = file ? file.name : '';
      saveBtn.disabled = !file;
    };

    saveBtn.onclick = async () => {
      if (!file) return;
      const ok = await confirmDialog({
        title: 'Importar respaldo',
        message: 'Se crearan rendiciones, fondos y gastos nuevos en tu cuenta a partir de este archivo. Los gastos ya existentes (mismo documento, o mismo monto y fecha) se saltan automaticamente. Continuar?',
        confirmText: 'Importar'
      });
      if (!ok) return;

      saveBtn.disabled = true;
      root.querySelector('[data-pick]').disabled = true;
      try {
        const { parseBackupFile, runImport } = await import('./migrationImport.js');
        statusEl.textContent = 'Leyendo archivo...';
        const backup = await parseBackupFile(file);
        const result = await runImport(backup, (msg) => { statusEl.textContent = msg; });
        statusEl.innerHTML = `
          Listo: ${result.reports} rendicion(es), ${result.transfers} fondo(s), ${result.expenses} gasto(s) importados.<br>
          ${result.skippedExpenses ? result.skippedExpenses + ' gasto(s) ya existian y se saltaron.<br>' : ''}
          ${result.bts ? result.bts + ' BT/proyecto(s) nuevas creadas.<br>' : ''}
          ${result.skippedBts ? result.skippedBts + ' BT(s) no se pudieron crear (sin permiso) y quedaron sin asignar.<br>' : ''}
          ${result.errors.length ? '<span style="color:var(--danger)">' + result.errors.length + ' error(es): ' + esc(result.errors.slice(0, 5).join(' | ')) + '</span>' : ''}
        `;
        toast('Importacion terminada', 'ok');
        saveBtn.textContent = 'Cerrar';
        saveBtn.disabled = false;
        saveBtn.onclick = () => close();
      } catch (e) {
        statusEl.textContent = '';
        toast('No se pudo importar: ' + (e.message || e), 'err');
        saveBtn.disabled = false;
        root.querySelector('[data-pick]').disabled = false;
      }
    };
  }});
}
