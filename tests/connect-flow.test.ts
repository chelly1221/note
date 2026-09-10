import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  settings: vi.fn(),
  connect: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('../lib/tailscale', () => ({ ensureTailscale: mocks.authenticate }));
vi.mock('../lib/sync', () => ({
  connectionSettings: mocks.settings,
  connectServer: mocks.connect,
  syncNow: mocks.sync,
}));
import { openNotebook } from '../lib/connect-flow';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ deviceName: 'Test device' });
});

describe('account-first connection', () => {
  it('waits for account approval before contacting the note server, then waits before opening notes', async () => {
    const account = Promise.withResolvers<void>();
    const identity = Promise.withResolvers<void>();
    const notes = Promise.withResolvers<void>();
    mocks.authenticate.mockReturnValue(account.promise);
    mocks.connect.mockReturnValue(identity.promise);
    mocks.sync.mockReturnValue(notes.promise);
    const stage = vi.fn();
    const opened = vi.fn();
    const work = openNotebook(stage).then(opened);
    await Promise.resolve();
    expect(stage).toHaveBeenLastCalledWith('account');
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
    account.resolve();
    await vi.waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith('Test device'),
    );
    expect(stage).toHaveBeenLastCalledWith('server');
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    identity.resolve();
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    expect(stage).toHaveBeenLastCalledWith('opening');
    expect(opened).not.toHaveBeenCalled();
    notes.resolve();
    await work;
    expect(opened).toHaveBeenCalledOnce();
  });

  it('stays at account authentication when approval fails or times out', async () => {
    mocks.authenticate.mockRejectedValue(
      new Error('Account approval timed out'),
    );
    const stage = vi.fn();
    await expect(openNotebook(stage)).rejects.toThrow('timed out');
    expect(stage.mock.calls).toEqual([['account']]);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('does not open notes when the authenticated account is denied by the server', async () => {
    mocks.authenticate.mockResolvedValue(undefined);
    mocks.connect.mockRejectedValue(new Error('Account not allowed'));
    const stage = vi.fn();
    await expect(openNotebook(stage)).rejects.toThrow('not allowed');
    expect(stage).toHaveBeenLastCalledWith('server');
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
