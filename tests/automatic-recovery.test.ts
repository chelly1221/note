import { afterEach, expect, test, vi } from "vitest";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
function runtime() {
  const workers: Array<{onmessage?: (e: {data: unknown}) => void; onerror?: () => void; postMessage: ReturnType<typeof vi.fn>}> = [];
  vi.stubGlobal("SharedWorker", undefined);
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("Worker", class {
    onmessage?: (e: {data: unknown}) => void;
    onerror?: () => void;
    postMessage = vi.fn();
    terminate() {}
    constructor() { workers.push(this); }
  });
  const state = (value: string) => workers.at(-1)!.onmessage?.({data: {type: 'state', value: {state:value, message:value, loginUrl:''}}});
  return {workers,state};
}
test('automatic reconnect shares a passive connection attempt and clears its timers', async () => {
  vi.useFakeTimers(); const {workers,state}=runtime();
  const {recoverTailscale}=await import('../lib/tailscale');
  const first=recoverTailscale(), second=recoverTailscale();
  expect(first).toBe(second); expect(workers).toHaveLength(1);
  expect(workers[0].postMessage).toHaveBeenCalledWith({type:'init',interactive:false});
  state('Running'); await first; expect(vi.getTimerCount()).toBe(0);
});
test('automatic reconnect never requests login and reports expired authentication promptly', async () => {
  vi.useFakeTimers(); const {workers,state}=runtime();
  const {recoverTailscale}=await import('../lib/tailscale');
  const result=expect(recoverTailscale()).rejects.toThrow('재인증'); state('NeedsLogin'); await result;
  await expect(recoverTailscale()).rejects.toThrow('재인증');
  expect(workers[0].postMessage).not.toHaveBeenCalledWith({type:'login'}); expect(vi.getTimerCount()).toBe(0);
});
test('unresponsive connection waits end after 45 seconds without leaking the ten minute wait', async () => {
  vi.useFakeTimers(); runtime(); const {recoverTailscale}=await import('../lib/tailscale');
  const result=expect(recoverTailscale()).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(46001); await result; expect(vi.getTimerCount()).toBe(0);
});
test('a failed transport can recover on the next attempt', async () => {
  vi.useFakeTimers(); const {workers,state}=runtime(); const {recoverTailscale}=await import('../lib/tailscale');
  const failed=expect(recoverTailscale()).rejects.toThrow(); state('Error'); await failed;
  const retry=recoverTailscale(); expect(workers).toHaveLength(2); state('Running'); await retry;
  await vi.runAllTimersAsync(); expect(vi.getTimerCount()).toBe(0);
});

test('a timed-out worker is replaced so later network recovery can succeed', async () => {
 vi.useFakeTimers(); const {workers,state}=runtime(); const {recoverTailscale}=await import('../lib/tailscale');
 const timeout=expect(recoverTailscale()).rejects.toMatchObject({name:'AbortError'});
 await vi.advanceTimersByTimeAsync(46001); await timeout;
 const retry=recoverTailscale(); expect(workers).toHaveLength(2); state('Running'); await retry;
 expect(vi.getTimerCount()).toBe(0);
});
