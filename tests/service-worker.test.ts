import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { serviceWorkerSource } from '../scripts/service-worker-template.mjs';

function worker() {
  const cachesByName = new Map<string, Map<string, Response>>();
  cachesByName.set(
    'note-shell-old',
    new Map([
      ['/', new Response('old shell')],
      ['/_next/static/chunks/old.js', new Response('old asset')],
    ]),
  );
  cachesByName.set(
    'note-shell-current',
    new Map([
      ['/', new Response('current shell')],
      ['/_next/static/chunks/current.js', new Response('current asset')],
    ]),
  );
  const events: Record<string, (event: unknown) => void> = {};
  const key = (request: string | { url: string }) =>
    typeof request === 'string' ? request : new URL(request.url).pathname;
  const cacheApi = {
    open: async (name: string) => ({
      match: async (request: string | { url: string }) =>
        cachesByName.get(name)?.get(key(request))?.clone(),
      addAll: vi.fn(),
    }),
    keys: async () => [...cachesByName.keys()],
    delete: async (name: string) => cachesByName.delete(name),
    match: async (request: string | { url: string }) => {
      for (const cache of cachesByName.values()) {
        const result = cache.get(key(request));
        if (result) return result.clone();
      }
    },
  };
  const fetch = vi.fn().mockRejectedValue(new Error('network offline'));
  const skipWaiting = vi.fn();
  vm.runInNewContext(
    serviceWorkerSource('note-shell-current', [
      '/',
      '/_next/static/chunks/current.js',
    ]),
    {
      self: {
        location: { origin: 'https://notes.test' },
        addEventListener: (name: string, handler: (event: unknown) => void) => {
          events[name] = handler;
        },
        clients: { claim: vi.fn() },
        skipWaiting,
      },
      caches: cacheApi,
      fetch,
      URL,
      Response,
    },
  );
  function request(pathname: string, mode = 'cors', method = 'GET') {
    let result: Promise<Response> | undefined;
    events.fetch({
      request: { url: 'https://notes.test' + pathname, mode, method },
      respondWith: (value: Promise<Response>) => {
        result = value;
      },
    });
    return result;
  }
  return { events, request, fetch, skipWaiting };
}

describe('offline shell and updates', () => {
  it('opens the current complete app shell without a network connection', async () => {
    const sw = worker();
    const response = await sw.request('/', 'navigate');
    expect(await response?.text()).toBe('current shell');
    expect(sw.fetch).not.toHaveBeenCalled();
  });
  it('can serve previous hashed assets to tabs still running the preceding version', async () => {
    const sw = worker();
    const response = await sw.request('/_next/static/chunks/old.js');
    expect(await response?.text()).toBe('old asset');
    expect(sw.fetch).not.toHaveBeenCalled();
  });
  it('never intercepts API requests or APK downloads', () => {
    const sw = worker();
    expect(sw.request('/api/sync/pull?cursor=0')).toBeUndefined();
    expect(sw.request('/downloads/note.apk', 'navigate')).toBeUndefined();
    expect(sw.request('/api/sync/push', 'cors', 'POST')).toBeUndefined();
  });
  it('activates an update only after an explicit activation message', () => {
    const sw = worker();
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    sw.events.message({ data: { type: 'unrelated' } });
    expect(sw.skipWaiting).not.toHaveBeenCalled();
    sw.events.message({ data: { type: 'ACTIVATE_UPDATE' } });
    expect(sw.skipWaiting).toHaveBeenCalledOnce();
  });
});
