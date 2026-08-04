// Lee una boleta/factura chilena con Gemini (IA en la nube) y devuelve los
// datos ya estructurados. La API key vive solo aca (variable de entorno),
// nunca se expone al navegador. El frontend (js/ocr.js) llama a este
// endpoint (via redirect desde /api/leer-boleta) y, si falla o no hay
// internet, sigue funcionando offline con Tesseract como respaldo.

const MODEL = 'gemini-flash-latest';

const CATEGORIES = [
  ['aliment', 'Alimentacion: restaurantes, cafes, almuerzos, cenas, panaderias, supermercados de comida'],
  ['petroleo', 'Petroleo: combustible/bencina/diesel para vehiculos'],
  ['peajes', 'Peajes/Est.: peajes de autopista o estacionamientos'],
  ['materiales', 'Materiales: ferreterias, materiales de construccion, herramientas'],
  ['otros', 'Otros: cualquier otro gasto que no calce en las anteriores']
].map(([id, desc]) => `- ${id}: ${desc}`).join('\n');

const PROMPT = `Eres un asistente que lee boletas y facturas chilenas (formato SII) a partir de una foto.
Extrae estos datos exactos de la imagen:

- amount: el monto TOTAL final a pagar (numero entero en pesos chilenos, sin puntos ni simbolo $). Si hay IVA, usa el total con IVA incluido, no el neto.
- date: la fecha de emision del documento, en formato ISO YYYY-MM-DD.
  IMPORTANTE sobre el formato de fecha: las boletas y facturas chilenas SIEMPRE escriben la fecha
  como DIA/MES/ANO o DIA-MES-ANO (nunca mes primero). Por ejemplo "24/06/26" significa dia=24,
  mes=06, ano=26 (2026), es decir 2026-06-24. NUNCA interpretes el primer numero como mes ni el
  ultimo como dia. Si el ano tiene 2 digitos, siempre es 20XX (nunca 19XX). Si el ano en la imagen
  se ve claramente erroneo o imposible (por ejemplo un ano futuro lejano o muy antiguo), usa tu
  mejor estimacion del ano actual manteniendo el mismo dia y mes.
- merchant: el nombre del comercio o razon social que emite el documento (no el receptor/cliente, no el medio de pago como Mercado Pago o Transbank si se puede identificar el comercio real detras).
- docNumber: el numero de boleta o folio (sin el RUT, sin el numero de operacion de la tarjeta salvo que sea lo unico disponible).
- docType: "boleta" o "factura" segun lo que diga el documento.
- categoryId: clasifica el gasto en UNA de estas categorias segun lo comprado:
${CATEGORIES}
- rawText: todo el texto que puedas leer en la boleta, tal cual aparece, en una sola cadena.

Si algun campo no se puede determinar, usa "" para texto o 0 para amount. Responde SOLO con el JSON.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    amount: { type: 'NUMBER' },
    date: { type: 'STRING' },
    merchant: { type: 'STRING' },
    docNumber: { type: 'STRING' },
    docType: { type: 'STRING', enum: ['boleta', 'factura'] },
    categoryId: { type: 'STRING', enum: ['aliment', 'petroleo', 'peajes', 'materiales', 'otros'] },
    rawText: { type: 'STRING' }
  },
  required: ['amount', 'date', 'merchant', 'docNumber', 'docType', 'categoryId', 'rawText']
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Metodo no permitido' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalido' }) };
  }

  const { imageBase64, mimeType } = payload || {};
  if (!imageBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta la imagen' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar GEMINI_API_KEY' }) };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1
    }
  };

  let resp;
  try {
    resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo contactar a la IA', detail: String((e && e.message) || e) }) };
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    return { statusCode: 502, body: JSON.stringify({ error: 'La IA respondio con error', status: resp.status, detail }) };
  }

  let data;
  try { data = await resp.json(); } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Respuesta de IA no es JSON valido' }) };
  }

  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!text) {
    return { statusCode: 502, body: JSON.stringify({ error: 'La IA no devolvio contenido' }) };
  }

  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo parsear la respuesta de la IA' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Number(parsed.amount) || 0,
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : '',
      merchant: String(parsed.merchant || '').trim(),
      docNumber: String(parsed.docNumber || '').replace(/\D/g, ''),
      docType: parsed.docType === 'factura' ? 'factura' : 'boleta',
      categoryId: ['aliment', 'petroleo', 'peajes', 'materiales', 'otros'].includes(parsed.categoryId) ? parsed.categoryId : 'otros',
      rawText: String(parsed.rawText || '')
    })
  };
};
