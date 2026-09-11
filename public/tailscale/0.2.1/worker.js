/* Note's embedded Tailscale worker. No authentication keys are shipped in this file. */
/* global Go, newIPN */
'use strict';
const ports = new Set();
let engine;
let boot;
let state = { state: 'Stopped', message: '연결 준비', loginUrl: '' };
let writes = Promise.resolve();
let watchId;
let watchTimer;
let watchFailures = 0;
let interactive = true;
let logoutWork = Promise.resolve();
const requests = new Map();
const emit = (message) => { for (const port of ports) port.postMessage(message); };
function publish(update) { state = { ...state, ...update }; emit({ type: 'state', value: state }); }
function failure(error) {
  publish({ state: 'Error', loginUrl: '', message: error instanceof Error ? error.message : '내장 연결을 시작하지 못했어요. 다시 시도해 주세요.' });
}
function openState() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('note-tailscale', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('연결 정보를 기기에 저장할 수 없어요.'));
  });
}
function readState(db) {
  return new Promise((resolve, reject) => {
    const store = db.transaction('state').objectStore('state');
    const result = Object.create(null);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (entry) { result[entry.key] = entry.value; entry.continue(); }
      else resolve(result);
    };
    cursor.onerror = () => reject(new Error('연결 정보를 읽지 못했어요.'));
  });
}
function writeState(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(new Error('연결 정보를 저장하지 못했어요.'));
  });
}
function validLoginUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'login.tailscale.com' && !url.username && !url.password; }
  catch { return false; }
}
async function runEngine() {
  const db = await openState();
  const stored = await readState(db);
  const hostname = stored['note-hostname'] || `note-${crypto.randomUUID().slice(0, 8)}`;
  await writeState(db, 'note-hostname', hostname);
  publish({ state: 'Loading', message: '보안 연결 준비 중 · 처음에는 잠시 걸릴 수 있어요.' });
  importScripts('./wasm_exec.js');
  const go = new Go();
  const response = await fetch('./main.wasm');
  if (!response.ok) throw new Error('연결 모듈을 다운로드하지 못했어요.');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
  void go.run(instance).then(() => failure(new Error('연결 엔진이 종료됐어요. 노트를 다시 열어 주세요.')), () => failure(new Error('연결 엔진에 오류가 발생했어요. 노트를 다시 열어 주세요.')));
  engine = newIPN({ hostname, stateStorage: {
    getState: (key) => stored[key] || '',
    setState: (key, value) => {
      stored[key] = value;
      writes = writes.then(() => writeState(db, key, value));
      void writes.catch(failure);
    },
  } });
  engine.run({
    notifyState: (value) => {
      const messages = { NeedsLogin: 'Tailscale 계정으로 로그인해 주세요.', NeedsMachineAuth: 'Tailscale 관리자 화면에서 이 기기의 승인을 기다리고 있어요.', Starting: '암호화된 연결을 여는 중', Running: '내장 Tailscale 연결됨', Stopped: '연결이 중지됐어요.' };
      if (value === 'Running') {
        void writes.then(() => { publish({ state: value, loginUrl: '', message: messages[value] }); startWatch(); }, failure);
      } else {
        stopWatch();
        publish({ state: value, message: messages[value] || '연결 준비 중', ...(value === 'NeedsMachineAuth' ? { loginUrl: '' } : {}) });
        if (value === 'NeedsLogin' && interactive) engine.login();
      }
    },
    notifyBrowseToURL: (url) => {
      if (validLoginUrl(url)) publish({ state: 'NeedsLogin', loginUrl: url, message: '로그인을 마치면 노트가 자동으로 열려요.' });
      else failure(new Error('Tailscale 로그인 주소를 확인할 수 없어요.'));
    },
    notifyNetMap: () => {},
    notifyPanicRecover: () => failure(new Error('연결을 복구하지 못했어요. 노트를 다시 열어 주세요.')),
  });
}
function start() {
  if (boot) return boot;
  if (!navigator.locks) {
    failure(new Error('이 브라우저는 안전한 내장 연결을 지원하지 않아요. 최신 브라우저로 열어 주세요.'));
    return Promise.reject(new Error(state.message));
  }
  boot = new Promise((resolve, reject) => {
    // SharedWorker shares one node across desktop tabs. The lock also prevents a
    // fallback worker or an older app version from using that private key twice.
    void navigator.locks.request('note-tailscale-node', { ifAvailable: true }, async (lock) => {
      if (!lock) { const error = new Error('다른 노트 창에서 연결을 사용 중이에요. 그 창을 닫고 다시 열어 주세요.'); failure(error); reject(error); return; }
      try { await runEngine(); resolve(); await new Promise(() => {}); }
      catch (error) { failure(error); reject(error); }
    }).catch((error) => { failure(error); reject(error); });
  });
  return boot;
}
function stopWatch() { clearTimeout(watchTimer); if (watchId) engine?.cancel(watchId); watchId = undefined; }
function startWatch() {
  if (watchId || state.state !== 'Running') return;
  const id = watchId = crypto.randomUUID();
  void engine.watch(id, (event) => { watchFailures = 0; emit({ type: 'event', event }); })
    .catch(() => { watchFailures++; })
    .finally(() => {
      if (watchId !== id) return;
      watchId = undefined;
      watchTimer = setTimeout(startWatch, Math.min(30000, 1000 * 2 ** Math.min(watchFailures, 5)));
    });
}
async function receive(port, message) {
  const { type, id } = message;
  if (type === 'init') { interactive = message.interactive !== false; port.postMessage({ type: 'state', value: state }); await start(); return; }
  if (type === 'cancel') { if (requests.get(id) === port) { engine?.cancel(id); requests.delete(id); } return; }
  if (type === 'close') { ports.delete(port); return; }
  if (type === 'login') { await start(); await logoutWork; interactive = true; engine.login(); return; }
  if (type === 'logout') {
    interactive = false;
    stopWatch();
    for (const request of requests.keys()) engine?.cancel(request);
    publish({ state: 'Stopped', loginUrl: '', message: '로그아웃했어요.' });
    logoutWork = Promise.resolve(engine?.logout()).then(() => writes);
    await logoutWork;
    return;
  }
  if (type === 'request') {
    if (state.state !== 'Running') throw new Error('Tailscale 연결을 기다리고 있어요.');
    requests.set(id, port);
    try {
      const result = await engine.request({ ...message, id });
      if (requests.has(id)) port.postMessage({ type: 'response', id, result }, [result.body.buffer]);
    } finally { requests.delete(id); }
  }
}
function attach(port) {
  ports.add(port);
  port.onmessage = ({ data }) => {
    void receive(port, data).catch((error) => {
      if (data.type === 'request') port.postMessage({ type: 'response', id: data.id, error: typeof error === 'string' ? error : error.message });
    });
  };
  port.start?.();
}
if ('onconnect' in self) self.onconnect = (event) => attach(event.ports[0]);
else attach(self);
