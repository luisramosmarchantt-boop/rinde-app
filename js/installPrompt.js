// Estado del prompt de instalacion de PWA (beforeinstallprompt), compartido
// entre app.js (que arma la pantalla completa al entrar) y las vistas que
// quieran ofrecer un boton para instalar en cualquier momento.
import { openSheet } from './ui.js';

let deferredPrompt = null;
let onAvailable = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  onAvailable?.();
});

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function canInstall() {
  return !isStandalone() && !!deferredPrompt;
}

// iOS (y iPadOS, que se anuncia como "MacIntel" pero tiene touch) nunca
// dispara beforeinstallprompt: ahi la instalacion es manual via el menu
// Compartir de Safari, asi que hay que mostrar instrucciones en vez de un
// boton.
export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canShowIOSInstallHint() {
  return isIOS() && !isStandalone();
}

// iOS no tiene instalacion con un clic: hay que guiar a la persona por el
// menu Compartir de Safari. Se puede abrir tanto desde el login como desde
// el aviso del dashboard.
export function showIOSInstallHelp() {
  openSheet(`
    <div class="sheet-head"><h2>📲 Instalar en iPhone</h2><button class="x" data-close>x</button></div>
    <p class="muted" style="margin-top:-6px">Safari no deja instalar con un solo boton como Chrome, pero toma 2 pasos:</p>
    <div class="card tight" style="margin-bottom:10px"><b>1. Toca Compartir</b><div class="muted tiny" style="margin-top:2px">El icono ⬆️ en la barra de Safari (abajo en el iPhone, arriba en el iPad).</div></div>
    <div class="card tight"><b>2. Elige "Agregar a inicio"</b><div class="muted tiny" style="margin-top:2px">Puede que tengas que bajar en la lista de opciones para verla.</div></div>
  `, { onMount: (root, close) => { root.querySelector('[data-close]').onclick = () => close(); } });
}

// El evento beforeinstallprompt suele llegar despues de la primera pintada
// de la pantalla de login, asi que sin este aviso el boton de instalar
// nunca alcanza a aparecer. La pantalla que lo use debe pasar su propio
// repintado y limpiar el listener (pasando null) al salir de esa pantalla.
export function onInstallAvailable(cb) {
  onAvailable = cb;
}

// Muestra el prompt nativo del navegador. Devuelve true si acepto instalar.
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome === 'accepted';
}
