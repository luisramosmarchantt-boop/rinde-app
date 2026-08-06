// Estado del prompt de instalacion de PWA (beforeinstallprompt), compartido
// entre app.js (que arma la pantalla completa al entrar) y las vistas que
// quieran ofrecer un boton para instalar en cualquier momento.
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
