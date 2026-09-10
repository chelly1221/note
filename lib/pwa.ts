import { Capacitor } from '@capacitor/core';
import { notify } from '@/components/notice';
import { finishEditing } from '@/lib/edit-session';

type OfflineSnapshot = {
  ready: boolean;
  updateAvailable: boolean;
  unsupported: boolean;
};
const initial: OfflineSnapshot = {
  ready: false,
  updateAvailable: false,
  unsupported: false,
};
let snapshot = initial;
let registration: ServiceWorkerRegistration | undefined;
let started = false;
const listeners = new Set<() => void>();
function publish(value: Partial<OfflineSnapshot>) {
  snapshot = { ...snapshot, ...value };
  for (const listener of listeners) listener();
}
export function subscribeOffline(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getOfflineSnapshot = () => snapshot;
export const getOfflineServerSnapshot = () => initial;

export async function applyOfflineUpdate() {
  if (registration?.waiting && (await finishEditing()))
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}
function offerUpdate() {
  if (!registration?.waiting || !navigator.serviceWorker.controller) return;
  publish({ updateAvailable: true });
}
export async function checkOfflineUpdate() {
  if (!registration) {
    notify('웹 앱을 다시 열면 업데이트를 확인할 수 있어요.');
    return;
  }
  try {
    await registration.update();
    if (registration.waiting) offerUpdate();
    else if (!registration.installing)
      notify('현재 최신 버전을 사용하고 있어요.');
  } catch {
    notify('연결이 돌아오면 업데이트를 확인할 수 있어요.');
  }
}

export async function registerOfflineShell() {
  if (Capacitor.isNativePlatform()) {
    publish({ ready: true });
    return;
  }
  if (started || process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) {
    publish({ unsupported: true });
    return;
  }
  started = true;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
    });
    offerUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration?.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offerUpdate();
      });
    });
    // Mobile browsers often keep a tab alive for days. Check on return as well.
    let lastCheck = 0;
    const checkOnReturn = () => {
      if (
        document.visibilityState === 'hidden' ||
        Date.now() - lastCheck < 60_000
      )
        return;
      lastCheck = Date.now();
      void registration
        ?.update()
        .then(offerUpdate)
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', checkOnReturn);
    window.addEventListener('online', checkOnReturn);
    checkOnReturn();
    let refreshing = false;
    let controlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controlled) {
        controlled = true;
        publish({ ready: true });
        return;
      }
      if (refreshing) return;
      void finishEditing().then((saved) => {
        if (saved && !refreshing) {
          refreshing = true;
          location.reload();
        }
      });
    });
    await navigator.serviceWorker.ready;
    publish({ ready: true });
  } catch {
    started = false;
    publish({ unsupported: true });
  }
}
