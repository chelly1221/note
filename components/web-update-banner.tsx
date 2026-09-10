'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  applyOfflineUpdate,
  getOfflineServerSnapshot,
  getOfflineSnapshot,
  registerOfflineShell,
  subscribeOffline,
} from '@/lib/pwa';

export function WebUpdateBanner() {
  const state = useSyncExternalStore(
    subscribeOffline,
    getOfflineSnapshot,
    getOfflineServerSnapshot,
  );
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void registerOfflineShell();
  }, []);
  if (!state.updateAvailable || dismissed) return null;
  return (
    <aside className="web-update-banner" aria-label="웹 업데이트">
      <div>
        <strong>새 웹 버전이 준비됐어요</strong>
        <p>{error || '작성 중인 내용을 저장한 뒤 새 화면을 열어요.'}</p>
      </div>
      <div className="web-update-actions">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await applyOfflineUpdate();
            } catch {
              setError('업데이트하지 못했어요. 다시 시도해 주세요.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={15} className={busy ? 'spin' : undefined} />새 버전
          적용
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setDismissed(true)}
        >
          나중에
        </Button>
      </div>
    </aside>
  );
}
