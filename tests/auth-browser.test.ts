import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: true,
  state: 'NeedsLogin',
  listener: undefined as (() => void) | undefined,
  open: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
  registerPlugin: () => ({ open: mocks.open, close: mocks.close }),
}));
vi.mock('../lib/tailscale', () => ({
  getTailscaleSnapshot: () => ({ state: mocks.state }),
  subscribeTailscale: (listener: () => void) => {
    mocks.listener = listener;
    return mocks.stop;
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.native = true;
  mocks.state = 'NeedsLogin';
  mocks.listener = undefined;
  mocks.open.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.stop.mockReset();
});
const login = 'https://login.tailscale.com/a/test-device';

it('keeps the authentication window open until the tunnel is Running, then closes it once', async () => {
  const auth = await import('../lib/auth-browser');
  await auth.openAuthBrowser(login);
  expect(mocks.open).toHaveBeenCalledWith({ url: login });
  for (const state of ['NeedsLogin', 'NeedsMachineAuth', 'Starting']) {
    mocks.state = state;
    mocks.listener?.();
  }
  expect(mocks.close).not.toHaveBeenCalled();
  mocks.state = 'Running';
  mocks.listener?.();
  mocks.listener?.();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it('handles approval arriving while the native window is opening', async () => {
  const opened = Promise.withResolvers<void>();
  mocks.open.mockReturnValue(opened.promise);
  const auth = await import('../lib/auth-browser');
  const work = auth.openAuthBrowser(login);
  mocks.state = 'Running';
  mocks.listener?.();
  expect(mocks.close).not.toHaveBeenCalled();
  opened.resolve();
  await work;
  expect(mocks.close).toHaveBeenCalledOnce();
});

it('does not launch arbitrary URLs or credentials in the native browser', async () => {
  const auth = await import('../lib/auth-browser');
  for (const url of [
    'http://login.tailscale.com/a/test',
    'https://login.tailscale.com.attacker.test/a/test',
    'https://u:p@login.tailscale.com/a/test',
    'https://example.com/',
    'https://console.tailscale.com/admin/settings',
  ]) {
    await expect(auth.openAuthBrowser(url)).rejects.toThrow('허용되지 않은');
  }
  expect(mocks.open).not.toHaveBeenCalled();
});

it('allows retry after opening fails and leaves normal web links alone', async () => {
  const auth = await import('../lib/auth-browser');
  mocks.open.mockRejectedValueOnce(new Error('No custom tabs provider'));
  await expect(auth.openAuthBrowser(login)).rejects.toThrow('No custom tabs');
  await auth.openAuthBrowser(login);
  expect(mocks.open).toHaveBeenCalledTimes(2);
  mocks.native = false;
  await auth.openAuthBrowser(login);
  expect(mocks.open).toHaveBeenCalledTimes(2);
});
