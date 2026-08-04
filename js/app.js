// ===== App principal: login, shell, navegacion, routing =====
import * as store from './store.js';
import * as auth from './auth.js';
import { startRouter, onRoute, navigate } from './router.js';
import {
  renderDashboard, renderExpenses, renderReports, renderReportDetail,
  renderStats, renderSettings, renderBTs,
  renderReviewerPanel, renderReviewerExpenseDetail, renderReviewerReportDetail,
  renderAdminPanel
} from './views.js';
import { openExpenseForm } from './forms.js';
import { esc } from './utils.js';

const appEl = document.getElementById('app');

// Config de cada pantalla
const SCREENS = {
  dashboard: { title: 'RindeApp Cloud', sub: 'Caja chica y rendiciones', render: renderDashboard, nav: 'dashboard' },
  expenses:  { title: 'Gastos', render: renderExpenses, nav: 'expenses' },
  reports:   { title: 'Rendiciones', render: renderReports, nav: 'reports' },
  stats:     { title: 'Estadisticas', render: renderStats, nav: 'stats' },
  settings:  { title: 'Ajustes', render: renderSettings, nav: 'settings' },
  bts:       { title: 'BT / Proyectos', render: renderBTs, nav: 'settings', back: 'settings' },
  report:    { title: 'Rendicion', render: (id) => renderReportDetail(id), nav: 'reports', back: 'reports' },
  panel:        { title: 'Panel', sub: 'Todo lo que se sube', render: renderReviewerPanel, nav: 'panel' },
  panelExpense: { title: 'Gasto', render: (id) => renderReviewerExpenseDetail(id), nav: 'panel', back: 'panel' },
  panelReport:  { title: 'Rendicion', render: (id) => renderReviewerReportDetail(id), nav: 'panel', back: 'panel' },
  admin:        { title: 'Administracion', render: renderAdminPanel, nav: 'panel', back: 'panel' }
};

function navFor(role) {
  const base = [
    { id: 'dashboard', label: 'Inicio', ic: '🏠', route: 'dashboard' },
    { id: 'expenses', label: 'Gastos', ic: '🧾', route: 'expenses' },
    { id: 'fab', fab: true },
    { id: 'reports', label: 'Rendiciones', ic: '📋', route: 'reports' },
    { id: 'settings', label: 'Ajustes', ic: '⚙️', route: 'settings' }
  ];
  if (role === 'reviewer' || role === 'admin') {
    base.splice(3, 0, { id: 'panel', label: 'Panel', ic: '🔎', route: 'panel' });
  }
  return base;
}

function renderShell(route) {
  const screen = SCREENS[route.name] || SCREENS.dashboard;
  const result = screen.render.length ? screen.render(route.param) : screen.render();
  const { html, mount } = result;
  const nav = navFor(store.myRole());

  const backBtn = screen.back
    ? `<button class="iconbtn" data-back></button>`
    : '';

  appEl.innerHTML = `
    <header class="appbar">
      ${backBtn}
      <h1>${esc(screen.title)}${screen.sub ? `<span class="sub">${esc(screen.sub)}</span>` : ''}</h1>
      ${route.name === 'dashboard' ? `<button class="iconbtn" data-quick-expense>+</button>` : ''}
    </header>
    <main class="screen">${html}</main>
    ${renderNav(screen.nav, nav)}
    <button class="fab" data-fab>+</button>
  `;

  appEl.querySelector('[data-back]')?.addEventListener('click', () => navigate(screen.back));
  appEl.querySelector('[data-quick-expense]')?.addEventListener('click', () => openExpenseForm());
  appEl.querySelector('[data-fab]')?.addEventListener('click', () => openExpenseForm(null, route.name === 'report' ? route.param : null));
  appEl.querySelectorAll('[data-nav]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); navigate(a.dataset.nav); }));

  const main = appEl.querySelector('.screen');
  if (mount) mount(main);

  window.scrollTo(0, 0);
}

function renderNav(active, nav) {
  return `<nav class="bottomnav">` + nav.map((n) => {
    if (n.fab) return `<a class="fab-slot"></a>`;
    return `<a href="#/${n.route}" data-nav="${n.route}" class="${active === n.id ? 'active' : ''}">
      <span class="ic">${n.ic}</span><span>${n.label}</span>
    </a>`;
  }).join('') + `</nav>`;
}

// ===== Login / registro (pantalla previa al shell) =====
function renderLogin(initial = {}) {
  let mode = initial.mode || 'login';
  let error = initial.error || '';
  let busy = false;

  function paint() {
    appEl.innerHTML = `
      <div class="auth-screen" style="padding:32px 20px;max-width:420px;margin:0 auto">
        <h1 style="margin-bottom:4px">RindeApp Cloud</h1>
        <p class="muted" style="margin-bottom:20px">${mode === 'login' ? 'Ingresa con tu RUT' : 'Crea tu cuenta con tu RUT'}</p>
        ${error ? `<div class="card" style="border:1px solid #d33;color:#d33;margin-bottom:14px">${esc(error)}</div>` : ''}
        <form id="authForm">
          <div class="field">
            <label>RUT</label>
            <input class="input" id="authRut" placeholder="12.345.678-9" required autocomplete="username" />
          </div>
          ${mode === 'register' ? `
          <div class="field">
            <label>Nombre completo</label>
            <input class="input" id="authName" placeholder="Como te veran las revisoras" required />
          </div>` : ''}
          <div class="field">
            <label>Contraseña</label>
            <input class="input" id="authPass" type="password" minlength="6" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" />
          </div>
          <button class="btn primary" type="submit" style="width:100%;margin-top:8px" ${busy ? 'disabled' : ''}>
            ${busy ? 'Un momento...' : (mode === 'login' ? 'Ingresar' : 'Crear cuenta')}
          </button>
        </form>
        <button id="toggleMode" class="btn ghost" style="width:100%;margin-top:10px">
          ${mode === 'login' ? 'No tengo cuenta, crear una' : 'Ya tengo cuenta, ingresar'}
        </button>
        ${mode === 'login' ? '<p class="muted tiny" style="margin-top:16px">¿Olvidaste tu clave? Pidele a la administradora que te la resetee.</p>' : ''}
      </div>
    `;
    appEl.querySelector('#toggleMode').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; error = ''; paint(); };
    appEl.querySelector('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      const rut = appEl.querySelector('#authRut').value;
      const password = appEl.querySelector('#authPass').value;
      const fullName = mode === 'register' ? appEl.querySelector('#authName').value : '';
      busy = true; error = ''; paint();
      try {
        if (mode === 'login') {
          await auth.signIn({ rut, password });
        } else {
          await auth.signUp({ rut, fullName, password });
        }
        await boot();
      } catch (err) {
        busy = false;
        error = translateAuthError(err);
        paint();
      }
    };
  }
  paint();
}

function translateAuthError(err) {
  const msg = String(err?.message || err || '');
  if (/already registered|already been registered/i.test(msg)) return 'Ese RUT ya tiene una cuenta. Inicia sesion en vez de crear una nueva.';
  if (/invalid login credentials/i.test(msg)) return 'RUT o contraseña incorrectos.';
  if (/password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
  return msg || 'Ocurrio un error, intenta de nuevo.';
}

// ===== Arranque =====
let currentRoute = null;
let unsubStore = null;
let stopRoute = null;
let booted = false;

export async function boot() {
  const session = await auth.getSession();
  if (!session) { renderLogin(); return; }

  try {
    await store.hydrate();
  } catch (e) {
    console.error('Error al cargar datos', e);
    await auth.signOut();
    renderLogin({ error: 'No se pudo cargar tu sesion. Intenta de nuevo.' });
    return;
  }

  if (!booted) {
    booted = true;
    unsubStore = store.subscribe(() => { if (currentRoute) renderShell(currentRoute); });
    stopRoute = onRoute((route) => { currentRoute = route; renderShell(route); });
    startRouter();
    registerServiceWorker();
  } else if (currentRoute) {
    renderShell(currentRoute);
  }
}

export async function logout() {
  store.teardownRealtime();
  if (unsubStore) unsubStore();
  booted = false;
  currentRoute = null;
  await auth.signOut();
  renderLogin();
}

auth.onAuthStateChange((session) => {
  if (!session && booted) {
    store.teardownRealtime();
    if (unsubStore) unsubStore();
    booted = false;
    currentRoute = null;
    renderLogin();
  }
});

boot();

// registro del service worker (PWA) con actualizacion forzada
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch((e) => console.warn('SW no registrado', e));
  });
  let hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
