'use strict';
// This standalone route also opens when an older app shell is cached.
const updateButton = document.getElementById('update');
const updateStatus = document.getElementById('status');
function waitForWorker(worker) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (worker.state === 'installed' || worker.state === 'activated')
        finish();
      else if (worker.state === 'redundant')
        finish(new Error('설치 파일을 준비하지 못했어요. 다시 시도해 주세요.'));
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error('연결이 느려지고 있어요. 잠시 후 다시 시도해 주세요.'),
        ),
      90000,
    );
    worker.addEventListener('statechange', changed);
    changed();
  });
}
updateButton.addEventListener('click', async () => {
  updateButton.disabled = true;
  updateStatus.textContent = '새 버전을 내려받고 있어요. 잠시만 기다려 주세요.';
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });
      await registration.update();
      if (registration.installing) await waitForWorker(registration.installing);
      if (registration.waiting) {
        await new Promise((resolve, reject) => {
          const changed = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            navigator.serviceWorker.removeEventListener(
              'controllerchange',
              changed,
            );
            reject(new Error('새 버전을 열지 못했어요. 다시 시도해 주세요.'));
          }, 30000);
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            changed,
            { once: true },
          );
          registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
        });
      }
    }
    location.replace('/');
  } catch (error) {
    updateStatus.textContent =
      error instanceof Error
        ? error.message
        : '인터넷 연결을 확인하고 다시 시도해 주세요.';
    updateButton.disabled = false;
  }
});
