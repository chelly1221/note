import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncScheduler } from '../lib/sync-scheduler';
afterEach(() => vi.useRealTimers());
describe('automatic network save scheduling', () => {
  it('syncs while typing continuously and again after the final input', () => {
    vi.useFakeTimers();
    const work = vi.fn();
    const scheduler = createSyncScheduler(work);
    for (let index = 0; index < 60; index++) {
      scheduler.request();
      vi.advanceTimersByTime(100);
    }
    expect(work).toHaveBeenCalledTimes(2);
    scheduler.request();
    vi.advanceTimersByTime(599);
    expect(work).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(3);
  });
  it('cancels pending requests and starts a fresh maximum wait when resumed', () => {
    vi.useFakeTimers();
    const work = vi.fn();
    const scheduler = createSyncScheduler(work);
    scheduler.request();
    scheduler.cancel();
    vi.advanceTimersByTime(5000);
    expect(work).not.toHaveBeenCalled();
    scheduler.request();
    vi.advanceTimersByTime(600);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
