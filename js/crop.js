// Recorte manual de la foto de boleta antes del OCR.
// Muestra la imagen a pantalla completa con un marco ajustable (esquinas
// arrastrables). Devuelve: Blob recortado, el archivo original ("usar
// completa") o null si el usuario cancela. Todo ocurre en el dispositivo.

const STYLE = `
  .rc-crop { position: fixed; inset: 0; z-index: 9999; background: rgba(10,12,20,.96);
    display: flex; flex-direction: column; touch-action: none; }
  .rc-crop-head { color: #fff; text-align: center; padding: 12px 16px 4px; font-size: 14px; }
  .rc-crop-head b { display: block; font-size: 16px; margin-bottom: 2px; }
  .rc-crop-stage { flex: 1; position: relative; display: flex; align-items: center;
    justify-content: center; overflow: hidden; padding: 8px; }
  .rc-crop-stage img { max-width: 100%; max-height: 100%; display: block; user-select: none;
    -webkit-user-drag: none; pointer-events: none; }
  .rc-crop-rect { position: absolute; border: 2px solid #3b82f6;
    box-shadow: 0 0 0 9999px rgba(0,0,0,.55); cursor: move; }
  .rc-crop-rect .h { position: absolute; width: 28px; height: 28px; background: #3b82f6;
    border-radius: 50%; border: 3px solid #fff; box-sizing: border-box; }
  .rc-crop-rect .h.tl { left: -14px; top: -14px; cursor: nwse-resize; }
  .rc-crop-rect .h.tr { right: -14px; top: -14px; cursor: nesw-resize; }
  .rc-crop-rect .h.bl { left: -14px; bottom: -14px; cursor: nesw-resize; }
  .rc-crop-rect .h.br { right: -14px; bottom: -14px; cursor: nwse-resize; }
  .rc-crop-actions { display: flex; gap: 8px; padding: 10px 12px calc(14px + env(safe-area-inset-bottom)); }
  .rc-crop-actions button { flex: 1; padding: 13px 8px; border-radius: 12px; border: 0;
    font-size: 15px; font-weight: 600; }
  .rc-crop-actions .use { background: #2563eb; color: #fff; }
  .rc-crop-actions .full { background: #273049; color: #dbe3f5; }
  .rc-crop-actions .cancel { background: transparent; color: #9aa5bd; }
`;

export function openCropper(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    probe.onload = () => {
      const overlay = document.createElement('div');
      overlay.className = 'rc-crop';
      overlay.innerHTML = `
        <style>${STYLE}</style>
        <div class="rc-crop-head"><b>Encuadra la boleta</b>Ajusta el marco para que el OCR lea mejor</div>
        <div class="rc-crop-stage">
          <img src="${url}" alt="foto"/>
          <div class="rc-crop-rect">
            <div class="h tl"></div><div class="h tr"></div>
            <div class="h bl"></div><div class="h br"></div>
          </div>
        </div>
        <div class="rc-crop-actions">
          <button type="button" class="cancel">Cancelar</button>
          <button type="button" class="full">Usar completa</button>
          <button type="button" class="use">✂️ Recortar</button>
        </div>`;
      document.body.appendChild(overlay);

      const img = overlay.querySelector('img');
      const rectEl = overlay.querySelector('.rc-crop-rect');
      let rect = null; // {x,y,w,h} relativo a la imagen mostrada

      function imgBox() { return img.getBoundingClientRect(); }
      function layout() {
        const b = imgBox();
        const stage = overlay.querySelector('.rc-crop-stage').getBoundingClientRect();
        rectEl.style.left = (b.left - stage.left + rect.x) + 'px';
        rectEl.style.top = (b.top - stage.top + rect.y) + 'px';
        rectEl.style.width = rect.w + 'px';
        rectEl.style.height = rect.h + 'px';
      }
      function initRect() {
        const b = imgBox();
        const inX = b.width * 0.06, inY = b.height * 0.06;
        rect = { x: inX, y: inY, w: b.width - inX * 2, h: b.height - inY * 2 };
        layout();
      }
      // La imagen puede tardar un frame en tomar su tamano final.
      if (img.complete) initRect(); else img.onload = initRect;
      setTimeout(() => { if (!rect) initRect(); }, 120);
      window.addEventListener('resize', () => { if (rect) initRect(); });

      // --- arrastre (mover / esquinas) con pointer events ---
      let drag = null;
      function startDrag(ev, mode) {
        ev.preventDefault();
        drag = { mode, sx: ev.clientX, sy: ev.clientY, r: { ...rect } };
      }
      rectEl.addEventListener('pointerdown', (ev) => {
        const h = ev.target.closest('.h');
        startDrag(ev, h ? h.className.replace('h ', '') : 'move');
      });
      window.addEventListener('pointermove', (ev) => {
        if (!drag || !rect) return;
        const b = imgBox();
        const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
        const r0 = drag.r, MIN = 40;
        let { x, y, w, h } = r0;
        if (drag.mode === 'move') { x = r0.x + dx; y = r0.y + dy; }
        else {
          if (drag.mode.includes('l')) { x = r0.x + dx; w = r0.w - dx; }
          if (drag.mode.includes('r')) { w = r0.w + dx; }
          if (drag.mode.includes('t')) { y = r0.y + dy; h = r0.h - dy; }
          if (drag.mode.includes('b')) { h = r0.h + dy; }
        }
        if (w < MIN) { if (drag.mode.includes('l')) x = r0.x + r0.w - MIN; w = MIN; }
        if (h < MIN) { if (drag.mode.includes('t')) y = r0.y + r0.h - MIN; h = MIN; }
        x = Math.max(0, Math.min(x, b.width - w));
        y = Math.max(0, Math.min(y, b.height - h));
        w = Math.min(w, b.width - x);
        h = Math.min(h, b.height - y);
        rect = { x, y, w, h };
        layout();
      });
      window.addEventListener('pointerup', () => { drag = null; });

      function finish(result) {
        overlay.remove();
        URL.revokeObjectURL(url);
        resolve(result);
      }
      overlay.querySelector('.cancel').onclick = () => finish(null);
      overlay.querySelector('.full').onclick = () => finish(file);
      overlay.querySelector('.use').onclick = () => {
        if (!rect) return finish(file);
        const b = imgBox();
        const scale = probe.naturalWidth / b.width;
        const sx = rect.x * scale, sy = rect.y * scale;
        const sw = Math.max(1, rect.w * scale), sh = Math.max(1, rect.h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(sw); canvas.height = Math.round(sh);
        canvas.getContext('2d').drawImage(probe, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob || file), 'image/jpeg', 0.92);
      };
    };
    probe.src = url;
  });
}
