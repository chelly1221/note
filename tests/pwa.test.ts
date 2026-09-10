import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const edit = vi.hoisted(() => vi.fn());
vi.mock('../lib/edit-session', () => ({ finishEditing: edit }));
vi.mock('../components/notice', () => ({ notify: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));
let registration: EventTarget & {
  waiting: { postMessage: ReturnType<typeof vi.fn> };
  update: ReturnType<typeof vi.fn>;
};
let serviceWorker: EventTarget & {
  controller: object;
  register: ReturnType<typeof vi.fn>;
  ready: Promise<unknown>;
};
let doc: EventTarget & { visibilityState: string };
let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  edit.mockReset().mockResolvedValue(true);
  registration = Object.assign(new EventTarget(), {
    waiting: { postMessage: vi.fn() },
    update: vi.fn().mockResolvedValue(undefined),
  });
  serviceWorker = Object.assign(new EventTarget(), {
    controller: {},
    register: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  });
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  reload = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { reload });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('keeps the update available without a toast host and bypasses the HTTP cache when checking', async () => {
  const pwa = await import('../lib/pwa');
  await pwa.registerOfflineShell();
  expect(pwa.getOfflineSnapshot().updateAvailable).toBe(true);
  expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', {
    updateViaCache: 'none',
  });
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
});

it('does not activate or reload when the editor cannot save', async () => {
  const pwa = await import('../lib/pwa');
  await pwa.registerOfflineShell();
  edit.mockResolvedValue(false);
  await pwa.applyOfflineUpdate();
  expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await Promise.resolve();
  expect(reload).not.toHaveBeenCalled();
  edit.mockResolvedValue(true);
  await pwa.applyOfflineUpdate();
  expect(registration.waiting.postMessage).toHaveBeenCalledWith({
    type: 'ACTIVATE_UPDATE',
  });
});

it('checks again when a phone returns to its tab, throttling repeated visibility events', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  const pwa = await import('../lib/pwa');
  await pwa.registerOfflineShell();
  registration.update.mockClear();
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).not.toHaveBeenCalled();
  vi.advanceTimersByTime(61000);
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).not.toHaveBeenCalled();
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).toHaveBeenCalledOnce();
});
