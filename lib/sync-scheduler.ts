/** Save locally on each input; batch network requests without starving continuous typing. */
export function createSyncScheduler(
  work: () => void,
  quietMs = 600,
  maximumMs = 3000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstRequestedAt: number | undefined;
  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    firstRequestedAt = undefined;
  }
  return {
    request() {
      const now = Date.now();
      firstRequestedAt ??= now;
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          cancel();
          work();
        },
        Math.max(0, Math.min(quietMs, maximumMs - (now - firstRequestedAt))),
      );
    },
    cancel,
  };
}
