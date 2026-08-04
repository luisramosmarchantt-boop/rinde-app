// OCR de boletas/facturas.
// Usa Tesseract.js desde CDN la primera vez; el service worker cachea esos
// archivos en el telefono para reutilizarlos despues.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';

let tessPromise = null;

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripAccents(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parseChileNumber(raw) {
  if (!raw) return 0;
  const normalized = String(raw)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  return Math.round(Number(normalized) || 0);
}

// Token de dinero: o bien viene con separador de miles (4.980 / 246.806)
// o bien es un numero "pelado" de 3 a 6 digitos. Asi evitamos confundir el
// total con numeros largos de operacion, ticket o tarjeta.
const MONEY_TOKEN = '([0-9]{1,3}(?:[.\\s][0-9]{3})+|[0-9]{3,6})(?:,[0-9]{1,2})?';

// Lineas de ruido que no deben aportar montos: timbre electronico (XML/TED),
// urls y bloques ilegibles del pie de las boletas.
function isNoiseLine(line) {
  return /[<>{}]|\bxml\b|version=|www\.|http|\.cl\b/i.test(line);
}

function findAmount(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !isNoiseLine(l));
  const money = new RegExp('(?:\\$|CLP)?\\s*' + MONEY_TOKEN, 'i');
  const exclude = /\b(SUBTOTAL|SUB TOTAL|NETO|IVA|AFECTO|EXENTO|DESCUENTO|VUELTO|CAMBIO|PROPINA|TARIFA)\b/;
  const isTotalLine = /\b(TOTAL|A PAGAR|PAGADO|PAGAR|COBRO)\b/;

  // 1) Lineas que digan TOTAL / A PAGAR / PAGADO (y no SUBTOTAL, NETO, IVA...).
  const preferred = lines.filter((line) => {
    const up = stripAccents(line).toUpperCase();
    return isTotalLine.test(up) && !exclude.test(up);
  });
  for (const line of preferred) {
    const m = line.match(money);
    const n = parseChileNumber(m?.[1]);
    if (n > 0) return n;
  }

  // 2) Fallback: el mayor monto "con pinta de plata", es decir con signo $/CLP
  //    o con separador de miles. Nunca numeros pelados largos (IDs, tarjetas).
  const candidates = [];
  for (const line of lines) {
    const up = stripAccents(line).toUpperCase();
    if (/\b(RUT|FONO|TELEFONO|FECHA|HORA|SII|GIRO|FOLIO|SERIE|TARJETA|OPERACION|AUTORIZACION|TERMINAL|CAJA|TICKET|MATRICULA)\b/.test(up)) continue;
    const hasCurrency = /(\$|CLP)/i.test(line);
    for (const m of line.matchAll(new RegExp(MONEY_TOKEN, 'g'))) {
      const token = m[1];
      const hasThousands = /[.\s]/.test(token);
      if (!hasCurrency && !hasThousands) continue; // descarta numeros pelados sueltos
      const n = parseChileNumber(token);
      if (n >= 100 && n < 100000000) candidates.push(n);
    }
  }
  return candidates.length ? Math.max(...candidates) : 0;
}

function findDocNumber(text) {
  const lines = text.split('\n');
  // Un numero seguido de "-digito" es un RUT (99554390-7); nunca es folio.
  const grabNumber = (line, min) => {
    const re = new RegExp(`([0-9]{${min},12})(?!-?\\s*\\d)`);
    const m = line.match(re);
    return m ? m[1] : '';
  };
  // Lineas que traen numeros que NO son folio (RUT, serie del equipo, tarjeta).
  const skip = (up) => /\b(RUT|SERIE|TARJETA|AUTORIZACION|TERMINAL)\b/.test(up);
  // 1) Linea de boleta/folio/factura con un numero (ignorando lineas de RUT).
  for (const line of lines) {
    const up = stripAccents(line).toUpperCase();
    if (skip(up)) continue;
    if (/\b(BOLETA|FOLIO|FACTURA)\b/.test(up)) {
      const n = grabNumber(line, 3);
      if (n) return n;
    }
  }
  // 2) Etiqueta generica N° / NRO / NUMERO, sin confundir con el RUT.
  for (const line of lines) {
    const up = stripAccents(line).toUpperCase();
    if (skip(up)) continue;
    if (/\b(NRO|NUMERO|FOLIO)\b|\bN[O°º.]?\s*[:#]?\s*\d{3,}/.test(up)) {
      const n = grabNumber(line, 4);
      if (n) return n;
    }
  }
  // 3) Vouchers de pago (Mercado Pago / GETNET / Transbank): el numero de
  //    operacion o aprobacion hace de folio. (La linea puede traer tambien la
  //    autorizacion; grabNumber toma el primer numero, que es la operacion.)
  for (const line of lines) {
    const up = stripAccents(line).toUpperCase();
    if (/\b(RUT|SERIE|TARJETA)\b/.test(up)) continue;
    if (/\b(OPERACION|APROBACION)\b/.test(up)) {
      const n = grabNumber(line, 4);
      if (n) return n;
    }
  }
  return '';
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

function buildDate(y, m, d) {
  const yyyy = String(y).length === 2 ? `20${y}` : String(y);
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  return `${yyyy}-${mm}-${dd}`;
}

// Una fecha de boleta razonable: no futura y de hace menos de ~14 meses.
// Evita tomar anos mal leidos por el OCR (2020, 2076) o fechas de vencimiento.
function isReasonableDate(iso) {
  if (!iso) return false;
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return false;
  const now = new Date();
  const diffDays = (now - d) / 86400000;
  return diffDays >= -1 && diffDays <= 430;
}

function findDate(text) {
  const candidates = [];
  // 1) ISO: 2026-05-13  (probar primero para no confundir con dd-mm-yy)
  for (const m of text.matchAll(/\b(20\d{2})-([01]?\d)-([0-3]?\d)\b/g)) {
    candidates.push(buildDate(m[1], m[2], m[3]));
  }
  // 2) dd/mm/yyyy o dd-mm-yy
  for (const m of text.matchAll(/\b([0-3]?\d)[/-]([01]?\d)[/-](20\d{2}|\d{2})\b/g)) {
    candidates.push(buildDate(m[3], m[2], m[1]));
  }
  // 3) Texto: "14 de Mayo del 2026" / "14 de mayo de 2026"
  for (const m of stripAccents(text).toLowerCase().matchAll(/\b([0-3]?\d)\s+de\s+([a-z]+)\s+(?:de[l]?\s+)?(20\d{2})\b/g)) {
    if (MESES[m[2]]) candidates.push(buildDate(m[3], MESES[m[2]], m[1]));
  }
  // 4) Abreviado: "17 JUN 2026"
  const MES3 = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
  for (const m of stripAccents(text).toLowerCase().matchAll(/\b([0-3]?\d)\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+(20\d{2})\b/g)) {
    candidates.push(buildDate(m[3], MES3[m[2]], m[1]));
  }
  // Devuelve la primera candidata con sentido (descarta anos absurdos).
  for (const c of candidates) if (isReasonableDate(c)) return c;
  return '';
}

// Encabezados, etiquetas y bloques que NO son el nombre del comercio
// (medios de pago, datos del receptor/cliente, timbres SII, etc.).
const MERCHANT_SKIP = /\b(BOLETA|FACTURA|ELECTRONICA|RUT|GIRO|DIRECCION|TOTAL|IVA|NETO|S\.?I\.?I\.?|FECHA|HORA|FOLIO|TIMBRE|RECIBO|COMPROBANTE|TICKET|APROBAD[OA]|APROBACION|OPERACION|MASTERCARD|VISA|CREDITO|DEBITO|TARJETA|TRANSBANK|MERCADO\s?PAGO|GETNET|KLAP|NFC|AID|TERMINAL|VALIDO\s+COMO|COMPRA|PROPINA|MONTO|VUELTO|DUPLICADO|COPIA|SERIE|SUCURSAL|MATRIZ|COMUNA|REGION|EMISOR|CONTADO|ESTIMADO|PUNTOS|VERIFIQUE|VERIFICA|GRACIAS|SE[NÑ]OR(?:ES)?|CLIENTE|ATENDEDOR|VENDEDOR|CAJERO)\b/i;

function merchantClean(s) {
  return s
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,&-]/g, '')
    .replace(/^(R\.?\s?SOCIAL|RAZON SOCIAL)\s*/i, '')   // quita la etiqueta
    .replace(/^(?:[A-Za-z0-9]\s+)+/, '')                // basura suelta: "y ", "4 ", "a "
    .replace(/\s*\d{1,2}\.\d{3}\.\d{3}-?\s*[\dkK]?\s*$/, '') // quita un RUT al final
    .trim().slice(0, 48);
}

function merchantUsable(line) {
  const letters = (line.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
  return letters >= 5;
}

function findMerchant(text) {
  const raw = text.split('\n').map((l) => l.trim()).filter((l) =>
    l.length >= 3 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(l) && !isNoiseLine(l));

  // Vouchers de pago (Mercado Pago / GETNET / Transbank / KLAP): el nombre del
  // comercio viene despues de "VALIDO COMO BOLETA" o justo tras la linea "Rut:".
  const isVoucher = /(MERCADO\s?PAGO|GETNET|TRANSBANK|KLAP)/i.test(stripAccents(text));
  if (isVoucher) {
    for (let i = 0; i < raw.length; i++) {
      const up = stripAccents(raw[i]).toUpperCase();
      if (/VALIDO\s+COMO\s+BOLETA/.test(up) || /^RUT\b/.test(up.replace(/[^A-Z ]/g, ''))) {
        for (let j = i + 1; j < Math.min(i + 3, raw.length); j++) {
          const upJ = stripAccents(raw[j]).toUpperCase();
          if (MERCHANT_SKIP.test(upJ) || !merchantUsable(raw[j])) continue;
          return merchantClean(raw[j]);
        }
      }
    }
  }

  // Primera linea util: con suficientes letras (descarta codigos cortos tipo
  // "ORD:251") y que no sea encabezado, medio de pago ni datos del cliente.
  for (const line of raw) {
    const up = stripAccents(line).toUpperCase();
    if (MERCHANT_SKIP.test(up)) continue;
    if (!merchantUsable(line)) continue;
    return merchantClean(line);
  }
  return '';
}

function classify(text) {
  const up = stripAccents(text).toUpperCase();
  // 1) Estacionamiento / peajes: la palabra manda (aunque sea de una bencinera).
  if (/\b(PEAJE|ESTACIONAMIENTOS?|ESTACIONAR|PARKING|APARCAMIENTO|PARQUIMETROS?|SHORTTERM|ESTANCIA|ESTADIA|SABA|TAG|AUTOPISTA)\b/.test(up)) return 'peajes';
  // 2) Combustible SOLO con palabras de combustible reales. La marca sola no
  //    basta: en un Copec/Pronto tambien se compra comida (cafe, sandwich).
  if (/\b(GASOLINA|BENCINA|DIESEL|PETROLEO|COMBUSTIBLE|LITROS?|OCTANOS)\b/.test(up)) return 'petroleo';
  // 3) Comida: items tipicos de boletas chilenas (con plurales).
  if (/\b(RESTAURANTE?S?|ALMUERZOS?|CENAS?|DESAYUNOS?|CAFES?|AMERICANOS?|CROISSANTS?|LATTES?|CAPUCHINOS?|EXPRESOS?|SANDWICH(ES)?|HOT\s?DOGS?|PANADERIAS?|PASTELERIAS?|CIABATTAS?|EMPANADAS?|MENUS?|COLACION(ES)?|COMIDAS?|BEBIDAS?|JUGOS?|MCDONALD|BURGERS?|PIZZAS?|SUSHI|BAR|VERDULERIAS?|ALMACEN(ES)?|ALIMENTOS?|GASTRONOM\w*)\b/.test(up)) return 'aliment';
  // 4) Materiales / ferreteria.
  if (/\b(FERRETERIAS?|MATERIALES?|ELECTRICOS?|CABLES?|HERRAMIENTAS?|TORNILLOS?|SODIMAC|EASY|CONSTRUMART|IMPERIAL)\b/.test(up)) return 'materiales';
  // 5) Marca de bencinera sin detalle: probablemente combustible.
  if (/\b(COPEC|SHELL|PETROBRAS|ENEX|ESMAX|PETRONOR|ARAMCO)\b/.test(up)) return 'petroleo';
  return 'otros';
}

export function parseReceiptText(text) {
  const rawText = cleanText(text);
  const normalized = stripAccents(rawText).toUpperCase();
  return {
    rawText,
    amount: findAmount(rawText),
    date: findDate(rawText),
    merchant: findMerchant(rawText),
    docType: /FACTURA/.test(normalized) ? 'factura' : 'boleta',
    docNumber: findDocNumber(rawText),
    categoryId: classify(rawText)
  };
}

// Preprocesa la imagen para mejorar el OCR de boletas termicas:
// reescala a un tamano util, pasa a escala de grises y estira el contraste.
// Devuelve un canvas (Tesseract acepta canvas directamente).
function preprocess(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const long = Math.max(width, height);
      const short = Math.min(width, height);
      // Subir resolucion si la foto es chica; bajar si es enorme.
      let scale = 1;
      if (short < 1200) scale = 1200 / short;
      if (long * scale > 2400) scale = 2400 / long;
      width = Math.round(width * scale);
      height = Math.round(height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, width, height);

      try {
        const imgData = ctx.getImageData(0, 0, width, height);
        const d = imgData.data;
        // Escala de grises + min/max para estirar contraste.
        let min = 255, max = 0;
        const gray = new Uint8ClampedArray(d.length / 4);
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
          gray[j] = g;
          if (g < min) min = g;
          if (g > max) max = g;
        }
        const range = Math.max(1, max - min);
        for (let i = 0, j = 0; i < d.length; i += 4, j++) {
          // Estira contraste y aplica una gamma suave para realzar el texto.
          let v = ((gray[j] - min) / range) * 255;
          v = Math.pow(v / 255, 0.8) * 255;
          v = Math.max(0, Math.min(255, v));
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
      } catch (e) {
        // Si getImageData falla (raro), seguimos con la imagen reescalada.
      }
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

// ==========================================================================
// Lectura por IA (Gemini). Es el metodo principal: entiende la boleta como
// una persona, sin depender de las expresiones regulares. La imagen se manda
// a una funcion serverless propia (/api/leer-boleta) que guarda la API key en
// secreto. Si no hay internet o la funcion falla, se cae a Tesseract (offline).
// ==========================================================================

const AI_ENDPOINT = '/api/leer-boleta';
const CATEGORY_IDS = ['aliment', 'petroleo', 'peajes', 'materiales', 'otros'];

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}

// Reescala la foto (manteniendo color) y la deja en JPEG para subir rapido
// y gastar menos tokens. Si algo falla, devuelve el blob original.
function downscaleForAI(blob, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((out) => resolve(out || blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

async function readWithAI(blob, onProgress) {
  onProgress('leyendo con IA');
  const prepared = await downscaleForAI(blob);
  const imageBase64 = await blobToBase64(prepared);
  const resp = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' })
  });
  if (!resp.ok) throw new Error('IA no disponible (' + resp.status + ')');
  return resp.json();
}

// Arma el objeto final con la MISMA forma que parseReceiptText, para que el
// resto de la app no cambie. Rellena con los parsers de texto lo que la IA
// no haya podido sacar.
function buildFromAI(ai) {
  const rawText = cleanText(ai.rawText || '');
  const amount = Number(ai.amount) > 0 ? Math.round(Number(ai.amount)) : findAmount(rawText);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ai.date || '') ? ai.date : findDate(rawText);
  const merchant = (ai.merchant && String(ai.merchant).trim()) || findMerchant(rawText);
  const docNumber = (ai.docNumber && String(ai.docNumber).replace(/\D/g, '')) || findDocNumber(rawText);
  const docType = ai.docType === 'factura' || ai.docType === 'boleta'
    ? ai.docType
    : (/FACTURA/.test(stripAccents(rawText).toUpperCase()) ? 'factura' : 'boleta');
  const categoryId = CATEGORY_IDS.includes(ai.categoryId) ? ai.categoryId : classify(rawText || merchant || '');
  return { rawText, amount, date, merchant, docType, docNumber, categoryId };
}

export async function readReceipt(blob, onProgress = () => {}) {
  // 1) Intento principal: IA.
  try {
    const ai = await readWithAI(blob, onProgress);
    const parsed = buildFromAI(ai);
    // Si saco algo util (monto o texto), lo damos por bueno.
    if (parsed.amount || parsed.rawText) return parsed;
  } catch (e) {
    // Sin conexion o funcion caida: seguimos al respaldo offline.
  }
  // 2) Respaldo: Tesseract en el telefono (funciona sin internet).
  return readWithTesseract(blob, onProgress);
}

async function readWithTesseract(blob, onProgress = () => {}) {
  if (!tessPromise) tessPromise = import(TESSERACT_URL);
  const tesseract = await tessPromise;
  const recognize = tesseract.recognize || tesseract.default?.recognize;
  if (!recognize) throw new Error('Motor OCR no disponible');

  onProgress('preparando imagen');
  const image = await preprocess(blob);

  const result = await recognize(image, 'spa+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(Math.round((m.progress || 0) * 100));
      else if (m.status) onProgress(m.status);
    }
  });
  const text = result?.data?.text || '';
  return parseReceiptText(text);
}
