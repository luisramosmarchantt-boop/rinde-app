// Generacion de PDF y compartir, 100% en el dispositivo.
// Usa jsPDF (+autoTable) cargado desde CDN la primera vez; el service worker
// lo cachea en el telefono (igual que el motor OCR). El PDF se arma de forma
// vectorial (texto/tablas nativas + addImage para las fotos), sin rasterizar
// el DOM: es mas confiable y usa menos memoria. Netlify no guarda ni procesa
// nada; todo se genera localmente con los datos del propio celular.

const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
const AUTOTABLE_URL = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';

let libsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

// Carga jsPDF + autoTable una sola vez y devuelve la clase jsPDF.
export async function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) {
    return window.jspdf.jsPDF;
  }
  if (!libsPromise) {
    libsPromise = (async () => {
      await loadScript(JSPDF_URL);
      await loadScript(AUTOTABLE_URL);
      return window.jspdf.jsPDF;
    })().catch((e) => { libsPromise = null; throw e; });
  }
  return libsPromise;
}

// Crea un documento jsPDF A4 vertical listo para dibujar.
export async function newDoc(orientation = 'portrait') {
  const JsPDF = await loadJsPDF();
  return new JsPDF({ unit: 'mm', format: 'a4', orientation });
}

// Comparte archivos con la hoja del sistema (el usuario elige WhatsApp).
// Devuelve 'shared', 'cancel' o 'unsupported'.
export async function shareFiles(files, { title = '', text = '' } = {}) {
  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title, text });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancel';
    // si compartir archivos falla, caemos a 'unsupported'
  }
  return 'unsupported';
}

export function pdfFile(blob, filename) {
  return new File([blob], filename, { type: 'application/pdf' });
}
