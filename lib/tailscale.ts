export interface TailState {
  state: string;
  message: string;
  loginUrl: string;
}
const initial: TailState = {
  state: 'Stopped',
  message: '연결 준비',
  loginUrl: '',
};
let snapshot = initial;
const listeners = new Set<() => void>();
const events = new Set<() => void>();
let port: MessagePort | Worker | undefined;
let owner: SharedWorker | Worker | undefined;
const pending = new Map<
  string,
  {
    resolve: (result: Response) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
  }
>();
export const subscribeTailscale = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getTailscaleSnapshot = () => snapshot;
export const getServerTailscaleSnapshot = () => initial;
function publish(value: TailState) {
  snapshot = value;
  for (const listener of listeners) listener();
}
function setup() {
  if (port) return;
  const url = '/tailscale/0.2.1/worker.js';
  if (typeof SharedWorker !== 'undefined') {
    try {
      owner = new SharedWorker(url, { name: 'note-tailscale-0.2.1' });
      port = owner.port;
      port.start();
    } catch {
      owner = new Worker(url);
      port = owner;
    }
  } else {
    owner = new Worker(url);
    port = owner;
  }
  owner.onerror = () => {
    const message = '보안 연결을 열지 못했어요. 노트를 다시 열어 주세요.';
    publish({ state: 'Error', loginUrl: '', message });
    for (const work of pending.values()) {
      work.cleanup();
      work.reject(new Error(message));
    }
    pending.clear();
  };
  port.onmessage = ({ data }) => {
    if (data.type === 'state') publish(data.value as TailState);
    if (data.type === 'event') for (const listener of events) listener();
    if (data.type === 'response') {
      const work = pending.get(data.id);
      if (!work) return;
      pending.delete(data.id);
      work.cleanup();
      if (data.error)
        work.reject(
          new Error(
            '암호화된 서버 연결이 끊겼어요. 잠시 후 다시 시도해 주세요.',
          ),
        );
      else
        work.resolve(
          new Response(data.result.body, {
            status: data.result.status,
            headers: data.result.headers,
          }),
        );
    }
  };
  port.postMessage({ type: 'init' });
  if (typeof window !== 'undefined')
    window.addEventListener('pagehide', (event) => {
      if (!event.persisted) port?.postMessage({ type: 'close' });
    });
}
export async function ensureTailscale(): Promise<void> {
  const existing = Boolean(port);
  setup();
  if (snapshot.state === 'Running') return;
  if (snapshot.state === 'Error') throw new Error(snapshot.message);
  if (
    existing &&
    (snapshot.state === 'NeedsLogin' || snapshot.state === 'Stopped')
  )
    port?.postMessage({ type: 'login' });
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const unsubscribe = subscribeTailscale(() => {
      if (snapshot.state === 'Running') finish();
      else if (snapshot.state === 'Error') finish(new Error(snapshot.message));
    });
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            '로그인 대기 시간이 지났어요. 연결 버튼을 다시 눌러 주세요.',
          ),
        ),
      10 * 60_000,
    );
  });
}
export function logoutTailscale() {
  port?.postMessage({ type: 'logout' });
  publish({ state: 'Stopped', loginUrl: '', message: '로그아웃했어요.' });
}
export function subscribeTailEvents(listener: () => void) {
  events.add(listener);
  return () => {
    events.delete(listener);
  };
}
export async function tailscaleFetch(
  input: string,
  options: RequestInit = {},
): Promise<Response> {
  // Every note request crosses the embedded WireGuard stack. No native fetch fallback.
  const url = new URL(input);
  if (
    url.origin !== 'https://audax-vm.tail62313c.ts.net:8443' ||
    !url.pathname.startsWith('/api/')
  )
    throw new Error('허용되지 않은 노트 서버 주소예요.');
  if (snapshot.state !== 'Running')
    throw new Error('Tailscale 연결을 기다리고 있어요.');
  options.signal?.throwIfAborted();
  const body =
    options.body == null
      ? new Uint8Array()
      : new Uint8Array(await new Response(options.body).arrayBuffer());
  options.signal?.throwIfAborted();
  if (body.length > 16 * 1024 * 1024)
    throw new Error('전송할 파일이 너무 커요.');
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const abort = () => {
      port?.postMessage({ type: 'cancel', id });
      pending.delete(id);
      cleanup();
      reject(new DOMException('요청이 취소됐어요.', 'AbortError'));
    };
    const timer = setTimeout(abort, 50_000);
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    };
    pending.set(id, { resolve, reject, cleanup });
    options.signal?.addEventListener('abort', abort, { once: true });
    port!.postMessage(
      {
        type: 'request',
        id,
        path: url.pathname + url.search,
        method: (options.method ?? 'GET').toUpperCase(),
        headers: Object.fromEntries(new Headers(options.headers)),
        body,
      },
      [body.buffer],
    );
  });
}
