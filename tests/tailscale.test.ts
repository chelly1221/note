import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let transport: typeof import('../lib/tailscale');
type Message = {
  type: string;
  id?: string;
  body: Uint8Array;
  headers: Record<string, string>;
};
let sent: Message[];
let channel: {
  onmessage?: (event: { data: unknown }) => void;
  postMessage: (value: Message) => void;
  start: () => void;
};
let network: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  sent = [];
  channel = {
    start() {},
    postMessage(value) {
      sent.push(value);
      if (value.type === 'init')
        queueMicrotask(() =>
          channel.onmessage?.({
            data: {
              type: 'state',
              value: { state: 'Running', message: 'connected', loginUrl: '' },
            },
          }),
        );
    },
  };
  vi.stubGlobal(
    'SharedWorker',
    class {
      port = channel;
    },
  );
  network = vi.fn(() => {
    throw new Error('Direct networking is forbidden');
  });
  vi.stubGlobal('fetch', network);
  transport = await import('../lib/tailscale');
  await transport.ensureTailscale();
});
afterEach(() => vi.unstubAllGlobals());
describe('embedded Tailscale transport', () => {
  it('sends binary uploads through the worker and preserves the response MIME and bytes', async () => {
    const result = transport.tailscaleFetch(
      'https://audax-vm.tail62313c.ts.net:8443/api/attachments/test',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'X-Note-Request': '1' },
        body: new Blob([new Uint8Array([0, 127, 255])]),
      },
    );
    await vi.waitFor(() =>
      expect(sent.some((message) => message.type === 'request')).toBe(true),
    );
    const request = sent.find((message) => message.type === 'request')!;
    expect([...request.body]).toEqual([0, 127, 255]);
    expect(request.headers['x-note-request']).toBe('1');
    channel.onmessage?.({
      data: {
        type: 'response',
        id: request.id,
        result: {
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: new Uint8Array([255, 0, 128]),
        },
      },
    });
    const response = await result;
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      255, 0, 128,
    ]);
    expect(network).not.toHaveBeenCalled();
  });
  it('fails closed for public or arbitrary hosts, and when the tunnel is offline', async () => {
    for (const url of [
      'https://note.3chan.kr/api/status',
      'https://example.com/api/status',
      'https://audax-vm.tail62313c.ts.net:8443/elsewhere',
    ])
      await expect(transport.tailscaleFetch(url)).rejects.toThrow(
        '허용되지 않은',
      );
    channel.onmessage?.({
      data: {
        type: 'state',
        value: { state: 'NeedsLogin', message: 'login', loginUrl: '' },
      },
    });
    await expect(
      transport.tailscaleFetch(
        'https://audax-vm.tail62313c.ts.net:8443/api/status',
      ),
    ).rejects.toThrow('연결을 기다리고');
    expect(network).not.toHaveBeenCalled();
    expect(sent.filter((message) => message.type === 'request')).toHaveLength(
      0,
    );
  });
  it('cancels the WireGuard HTTP request when the caller aborts', async () => {
    const abort = new AbortController();
    const result = transport.tailscaleFetch(
      'https://audax-vm.tail62313c.ts.net:8443/api/status',
      { signal: abort.signal },
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.waitFor(() =>
      expect(sent.some((message) => message.type === 'request')).toBe(true),
    );
    abort.abort();
    await rejected;
    expect(sent.at(-1)?.type).toBe('cancel');
    expect(sent.at(-1)?.id).toBe(
      sent.find((message) => message.type === 'request')?.id,
    );
    expect(network).not.toHaveBeenCalled();
  });
  it('delivers server change events independently from request responses', () => {
    const changed = vi.fn();
    const unsubscribe = transport.subscribeTailEvents(changed);
    channel.onmessage?.({ data: { type: 'event', event: 'change' } });
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    channel.onmessage?.({ data: { type: 'event', event: 'change' } });
    expect(changed).toHaveBeenCalledOnce();
  });
});
