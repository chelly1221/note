import { Capacitor, registerPlugin } from '@capacitor/core';
import { getTailscaleSnapshot, subscribeTailscale } from './tailscale';

const browser = registerPlugin<{
  open(options: { url: string }): Promise<void>;
  close(): Promise<void>;
}>('AuthBrowser');
let opening: Promise<void> | undefined;
let stopWatching: (() => void) | undefined;

export function openAuthBrowser(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (opening) return opening;
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !(
      (parsed.hostname === 'login.tailscale.com' &&
        parsed.pathname.startsWith('/a/')) ||
      (parsed.hostname === 'console.tailscale.com' &&
        parsed.pathname === '/admin/machines')
    )
  ) {
    return Promise.reject(new Error('허용되지 않은 인증 주소예요.'));
  }
  // Listen before opening: approval may complete while the native window starts.
  stopWatching?.();
  let completed = false;
  let opened = false;
  const closeWhenApproved = () => {
    if (getTailscaleSnapshot().state !== 'Running' || completed || !opened)
      return;
    completed = true;
    stopWatching?.();
    stopWatching = undefined;
    void browser.close().catch(() => {
      // Authentication still succeeds if Android has already closed the window.
    });
  };
  stopWatching = subscribeTailscale(closeWhenApproved);
  opening = browser
    .open({ url })
    .then(() => {
      opened = true;
      closeWhenApproved();
    })
    .catch((error) => {
      stopWatching?.();
      stopWatching = undefined;
      throw error;
    })
    .finally(() => {
      opening = undefined;
    });
  return opening;
}
