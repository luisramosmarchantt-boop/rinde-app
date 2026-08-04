// ===== Gráficos sin dependencias (CSS / conic-gradient) =====
import { CHART_COLORS, formatMoney, esc, shortMonth } from './utils.js';

// Donut de categorías con leyenda
export function donutChart(items, currency) {
  const total = items.reduce((a, i) => a + i.total, 0);
  if (!total) return '<p class="muted center">Sin datos</p>';

  let acc = 0;
  const stops = items.map((it, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const start = (acc / total) * 100;
    acc += it.total;
    const end = (acc / total) * 100;
    return `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(', ');

  const legend = items.map((it, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const pct = Math.round((it.total / total) * 100);
    return `<div class="l">
      <span class="dot" style="background:${color}"></span>
      <span class="nm">${it.category.emoji} ${esc(it.category.name)}</span>
      <span class="vv">${pct}%</span>
    </div>`;
  }).join('');

  return `<div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(${stops})">
      <div class="center"><b>${formatMoney(total, currency)}</b><span>Total</span></div>
    </div>
    <div class="legend">${legend}</div>
  </div>`;
}

// Barras horizontales (ranking de categorías)
export function barList(items, currency) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return `<div class="bars">` + items.map((it, idx) => {
    const pct = (it.total / max) * 100;
    const color = CHART_COLORS[idx % CHART_COLORS.length];
    return `<div class="bar-row">
      <div class="bar-top">
        <span>${it.category.emoji} ${esc(it.category.name)}</span>
        <span class="mono">${formatMoney(it.total, currency)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:linear-gradient(90deg, ${color}, ${color}cc)"></div></div>
    </div>`;
  }).join('') + `</div>`;
}

// Barras verticales por mes
export function monthBars(months, currency) {
  const max = Math.max(...months.map((m) => m.total), 1);
  return `<div class="month-bars">` + months.map((m) => {
    const h = Math.max((m.total / max) * 100, 2);
    return `<div class="mb">
      <div class="col" style="height:${h}%" title="${formatMoney(m.total, currency)}"></div>
      <div class="lb">${shortMonth(m.ym)}</div>
    </div>`;
  }).join('') + `</div>`;
}
