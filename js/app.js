// ===== App principal: login, shell, navegacion, routing =====
import * as store from './store.js';
import * as auth from './auth.js';
import { startRouter, onRoute, navigate } from './router.js';
import {
  renderDashboard, renderExpenses, renderReports, renderReportDetail,
  renderStats, renderSettings, renderBTs, renderCargos,
  renderReviewerHome, renderReviewerPanel, renderReviewerWorkerDetail, renderReviewerExpenseDetail, renderReviewerReportDetail,
  renderAdminPanel, renderTeamMetrics, renderNotificationsHub, renderMyNotifications
} from './views.js';
import { esc } from './utils.js';
import { canInstall, promptInstall, onInstallAvailable, canShowIOSInstallHint, showIOSInstallHelp } from './installPrompt.js';

const appEl = document.getElementById('app');
const APP_NAME = 'Rendiciones Mataquito';

// Config de cada pantalla: el titulo se muestra como subtitulo bajo la marca.
const SCREENS = {
  dashboard: { title: 'Inicio', render: renderDashboard },
  expenses:  { title: 'Mis gastos', render: renderExpenses },
  reports:   { title: 'Mis rendiciones', render: renderReports },
  report:    { title: 'Rendicion', render: (id) => renderReportDetail(id) },
  stats:     { title: 'Estadisticas', render: renderStats },
  settings:  { title: 'Ajustes', render: renderSettings },
  bts:       { title: 'BT / Proyectos', render: renderBTs },
  cargos:    { title: 'Cargos', render: renderCargos },
  panel:          { title: 'Panel de revisora', render: renderReviewerHome },
  reviewQueue:    { title: 'Administrar rendiciones', render: renderReviewerPanel },
  panelWorker:    { title: 'Colaborador', render: (id) => renderReviewerWorkerDetail(id) },
  panelExpense:   { title: 'Gasto', render: (id) => renderReviewerExpenseDetail(id) },
  panelReport:    { title: 'Rendicion', render: (id) => renderReviewerReportDetail(id) },
  admin:          { title: 'Administracion', render: renderAdminPanel },
  metrics:        { title: 'Metricas del equipo', render: renderTeamMetrics },
  notifications:  { title: 'Notificaciones', render: renderNotificationsHub },
  inbox:          { title: 'Mis notificaciones', render: renderMyNotifications }
};

// La revisora "pura" (no admin) parte en el Panel (ella no rinde). El resto
// (colaborador y admin, que si rinden sus propios gastos) parte en Inicio.
function homeFor(role) { return role === 'reviewer' ? 'panel' : 'dashboard'; }

// Pantallas de revision/administracion: para la revisora cuelgan directo de
// su Panel (que ya es su Inicio); para el admin cuelgan de su pantalla de
// Administracion (que a su vez cuelga de su Inicio de colaborador).
const NESTED_UNDER_ADMIN = ['reviewQueue', 'metrics', 'notifications', 'bts', 'cargos'];
function parentRoute(name, role) {
  if (name === 'dashboard' || name === 'panel') return null;
  if (name === 'admin') return 'dashboard';
  if (NESTED_UNDER_ADMIN.includes(name)) return role === 'reviewer' ? 'panel' : 'admin';
  if (name === 'panelWorker' || name === 'panelExpense' || name === 'panelReport') return 'reviewQueue';
  if (name === 'report') return 'reports';
  if (name === 'expenses' || name === 'reports') return 'dashboard';
  return homeFor(role);
}

function renderShell(route) {
  const screen = SCREENS[route.name] || SCREENS.dashboard;
  const result = screen.render.length ? screen.render(route.param) : screen.render();
  const { html, mount } = result;
  const role = store.myRole();
  const home = homeFor(role);
  const parent = parentRoute(route.name, role);
  const isHome = route.name === home;

  appEl.innerHTML = `
    <header class="appbar2">
      <button class="navbtn back${parent ? '' : ' dim'}" data-back ${parent ? '' : 'disabled'}>&larr;</button>
      <div class="brand">
        <img src="icons/icon-192.png" alt="${APP_NAME}" />
        <h1>${APP_NAME}${screen.title ? `<span class="sub">${esc(screen.title)}</span>` : ''}</h1>
      </div>
      <button class="navbtn home${isHome ? ' active' : ''}" data-home>⌂</button>
    </header>
    <main class="screen">${html}</main>
  `;

  if (parent) appEl.querySelector('[data-back]').addEventListener('click', () => navigate(parent));
  appEl.querySelector('[data-home]').addEventListener('click', () => navigate(home));

  const main = appEl.querySelector('.screen');
  if (mount) mount(main);

  window.scrollTo(0, 0);
}

// ===== Login / registro (pantalla previa al shell) =====
function renderLogin(initial = {}) {
  let mode = initial.mode || 'login';
  let error = initial.error || '';
  let busy = false;

  onInstallAvailable(() => paint());

  function paint() {
    appEl.innerHTML = `
      <div class="auth-screen" style="padding:32px 20px;max-width:420px;margin:0 auto">
        <img src="icons/icon-192.png" alt="${APP_NAME}" style="width:76px;height:76px;display:block;margin:0 auto 14px" />
        <h1 style="margin-bottom:4px;text-align:center;font-size:24px">${APP_NAME}</h1>
        <p class="muted" style="margin-bottom:20px;text-align:center">${mode === 'login' ? 'Ingresa con tu RUT' : 'Crea tu cuenta con tu RUT'}</p>
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
        ${canInstall() ? '<button id="installBtn" class="btn outline" style="width:100%;margin-top:10px">📲 Instalar App Rendiciones</button>' : ''}
        ${canShowIOSInstallHint() ? '<button id="iosInstallBtn" class="btn outline" style="width:100%;margin-top:10px">📲 Instalar en iPhone</button>' : ''}
        ${mode === 'login' ? '<p class="muted tiny" style="margin-top:16px">¿Olvidaste tu clave? Pidele a la administradora que te la resetee.</p>' : ''}
      </div>
    `;
    appEl.querySelector('#toggleMode').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; error = ''; paint(); };
    appEl.querySelector('#installBtn')?.addEventListener('click', async () => { await promptInstall(); paint(); });
    appEl.querySelector('#iosInstallBtn')?.addEventListener('click', () => showIOSInstallHelp());
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
        onInstallAvailable(null);
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

  if (store.getProfile()?.mustChangePassword) {
    await forcePasswordChange();
  }

  if (!booted) {
    booted = true;
    registerServiceWorker();
    await maybeShowPushPrompt();
    unsubStore = store.subscribe(() => { if (currentRoute) renderShell(currentRoute); });
    stopRoute = onRoute((route) => { currentRoute = route; renderShell(route); });
    // La revisora "pura" parte en el Panel, no en el Inicio de colaborador;
    // si no hay un hash previo (o quedo uno de una sesion de otro rol en
    // este mismo navegador), se cae al Inicio correcto para este rol.
    if (!location.hash || !(SCREENS[location.hash.replace(/^#\/?/, '').split('/')[0]])) {
      location.hash = '#/' + homeFor(store.myRole());
    }
    startRouter();
  } else if (currentRoute) {
    renderShell(currentRoute);
  }
}

// Pantalla obligatoria (sin boton para saltarla) cuando la cuenta tiene una
// contraseña recien reseteada por la revisora/admin ("123456"). No deja pasar
// al resto de la app hasta que defina una propia.
async function forcePasswordChange() {
  await new Promise((resolve) => {
    function paint(error) {
      appEl.innerHTML = `
        <div class="auth-screen" style="padding:32px 20px;max-width:420px;margin:0 auto">
          <div style="font-size:48px;margin-bottom:12px;text-align:center">🔑</div>
          <h1 style="margin-bottom:8px;text-align:center">Crea tu nueva contraseña</h1>
          <p class="muted" style="margin-bottom:20px;text-align:center">Tu contraseña fue reseteada. Antes de seguir, define una nueva (minimo 6 caracteres).</p>
          ${error ? `<div class="card" style="border:1px solid #d33;color:#d33;margin-bottom:14px">${esc(error)}</div>` : ''}
          <form id="pwForm">
            <div class="field">
              <label>Nueva contraseña</label>
              <input class="input" id="newPass" type="password" minlength="6" required autocomplete="new-password" />
            </div>
            <div class="field">
              <label>Repite la contraseña</label>
              <input class="input" id="newPass2" type="password" minlength="6" required autocomplete="new-password" />
            </div>
            <button class="btn primary" type="submit" style="width:100%;margin-top:8px">Guardar y continuar</button>
          </form>
        </div>`;
      appEl.querySelector('#pwForm').onsubmit = async (e) => {
        e.preventDefault();
        const p1 = appEl.querySelector('#newPass').value;
        const p2 = appEl.querySelector('#newPass2').value;
        if (p1.length < 6) { paint('La contraseña debe tener al menos 6 caracteres.'); return; }
        if (p1 !== p2) { paint('Las contraseñas no coinciden.'); return; }
        try {
          await store.completePasswordChange(p1);
          resolve();
        } catch (err) {
          paint(translateAuthError(err));
        }
      };
    }
    paint();
  });
}

// Pantalla previa al shell, apenas se entra, pidiendo activar notificaciones
// (en vez de esperar a que alguien lo encuentre en Ajustes). No bloquea el
// acceso: "Ahora no" sigue de largo. Si ya estaba activado, rechazado, o el
// navegador no soporta push, no se muestra nada.
async function maybeShowPushPrompt() {
  let push;
  try {
    push = await import('./push.js');
    const state = await push.getSubscriptionState();
    if (state !== 'not-subscribed') return;
  } catch (e) { return; }

  await new Promise((resolve) => {
    appEl.innerHTML = `
      <div class="auth-screen" style="padding:32px 20px;max-width:420px;margin:0 auto;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">🔔</div>
        <h1 style="margin-bottom:8px">Activa las notificaciones</h1>
        <p class="muted" style="margin-bottom:24px">Te avisamos cuando tu revisora apruebe, objete o pida aclarar un gasto, y ante avisos generales del equipo.</p>
        <button class="btn primary" data-allow style="width:100%;margin-bottom:10px">Activar notificaciones</button>
        <button class="btn ghost" data-skip style="width:100%">Ahora no</button>
      </div>`;
    appEl.querySelector('[data-allow]').onclick = async () => {
      try { await push.subscribeToPush(store.myUserId()); } catch (e) { /* se puede activar despues desde Ajustes */ }
      resolve();
    };
    appEl.querySelector('[data-skip]').onclick = () => resolve();
  });
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
  const doRegister = () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch((e) => console.warn('SW no registrado', e));
  };
  // boot() puede terminar despues de que 'load' ya disparo (espera a
  // hydratar datos de Supabase), asi que si ya paso no hay que esperarlo.
  if (document.readyState === 'complete') doRegister();
  else window.addEventListener('load', doRegister);
  let hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
