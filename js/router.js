// ===== Router por hash (#/ruta/param) =====
const listeners = new Set();

export function onRoute(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  return { name: parts[0] || 'dashboard', param: parts[1] || null, parts };
}

export function navigate(path) {
  const target = '#/' + path.replace(/^#?\/?/, '');
  if (location.hash === target) {
    // fuerza re-render aunque no cambie
    listeners.forEach((fn) => fn(parseRoute()));
  } else {
    location.hash = target;
  }
}

export function back() {
  if (history.length > 1) history.back();
  else navigate('dashboard');
}

window.addEventListener('hashchange', () => {
  listeners.forEach((fn) => fn(parseRoute()));
});

export function startRouter() {
  if (!location.hash) location.hash = '#/dashboard';
  listeners.forEach((fn) => fn(parseRoute()));
}
