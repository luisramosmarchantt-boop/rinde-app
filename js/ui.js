// ===== Helpers de UI: hojas inferiores (sheets), confirmaciones =====
import { esc } from './utils.js';

let openCount = 0;

// Abre una hoja inferior. `html` es el contenido; onMount(rootEl, close) corre tras montar.
// dismissible=false impide cerrar tocando el fondo (para flujos obligatorios).
export function openSheet(html, { onMount, full = false, onClose, dismissible = true } = {}) {
  const root = document.getElementById('sheet-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (full ? ' full' : '');
  sheet.innerHTML = `<div class="grab"></div>` + html;
  root.appendChild(backdrop);
  root.appendChild(sheet);
  openCount++;
  document.body.style.overflow = 'hidden';

  requestAnimationFrame(() => { backdrop.classList.add('show'); sheet.classList.add('show'); });

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    backdrop.classList.remove('show');
    sheet.classList.remove('show');
    setTimeout(() => {
      backdrop.remove(); sheet.remove();
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.style.overflow = '';
      if (onClose) onClose(result);
    }, 260);
  }

  if (dismissible) backdrop.addEventListener('click', () => close());
  if (onMount) onMount(sheet, close);
  return close;
}

// Diálogo de confirmación. Devuelve Promise<boolean>.
export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const html = `
      <div class="sheet-head"><h2>${esc(title)}</h2></div>
      <p class="muted" style="margin-top:-4px">${esc(message)}</p>
      <div class="btn-row" style="margin-top:18px">
        <button class="btn outline" data-act="cancel">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(confirmText)}</button>
      </div>`;
    const close = openSheet(html, {
      onMount(root) {
        root.querySelector('[data-act="cancel"]').onclick = () => close(false);
        root.querySelector('[data-act="ok"]').onclick = () => close(true);
      },
      onClose: (r) => resolve(r === true)
    });
  });
}

// Selector simple tipo "action sheet"
export function actionSheet(title, options) {
  return new Promise((resolve) => {
    const opts = options.map((o, i) =>
      `<button class="btn ${o.danger ? 'danger' : 'outline'}" data-i="${i}" style="margin-bottom:8px">${o.emoji ? o.emoji + ' ' : ''}${esc(o.label)}</button>`
    ).join('');
    const html = `
      <div class="sheet-head"><h2>${esc(title)}</h2></div>
      <div>${opts}</div>
      <button class="btn ghost" data-cancel style="margin-top:4px">Cancelar</button>`;
    const close = openSheet(html, {
      onMount(root) {
        root.querySelectorAll('[data-i]').forEach((b) => {
          b.onclick = () => close(Number(b.dataset.i));
        });
        root.querySelector('[data-cancel]').onclick = () => close(null);
      },
      onClose: (r) => resolve(typeof r === 'number' ? r : null)
    });
  });
}
