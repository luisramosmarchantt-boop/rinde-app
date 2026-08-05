// Estado del prompt de instalacion de PWA (beforeinstallprompt), compartido
// entre app.js (que arma la pantalla completa al entrar) y las vistas que
// quieran ofrecer un boton para instalar en cualquier momento.
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function canInstall() {
  return !isStandalone() && !!deferredPrompt;
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
