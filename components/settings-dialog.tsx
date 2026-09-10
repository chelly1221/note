'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Cloud,
  CloudOff,
  Download,
  Upload,
  Link2,
  LoaderCircle,
  RefreshCw,
  Check,
  ShieldCheck,
  HardDrive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  connectionSettings,
  connectServer,
  disconnectServer,
  getServerSyncSnapshot,
  getSyncSnapshot,
  refreshPending,
  subscribeSync,
  syncNow,
} from '@/lib/sync';
import { exportNotebook, importNotebook } from '@/lib/export';
import { getSetting, setSetting } from '@/lib/database';
import { logoutTailscale } from '@/lib/tailscale';
import { notify } from '@/components/notice';
import { ANDROID_DOWNLOAD_URL, APP_VERSION } from '@/lib/model';
import { finishEditing } from '@/lib/edit-session';
import {
  applyOfflineUpdate,
  checkOfflineUpdate,
  getOfflineServerSnapshot,
  getOfflineSnapshot,
  subscribeOffline,
} from '@/lib/pwa';
import { Capacitor } from '@capacitor/core';

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const offline = useSyncExternalStore(
    subscribeOffline,
    getOfflineSnapshot,
    getOfflineServerSnapshot,
  );
  const sync = useSyncExternalStore(
    subscribeSync,
    getSyncSnapshot,
    getServerSyncSnapshot,
  );
  const [login, setLogin] = useState('');
  const [device, setDevice] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [persistent, setPersistent] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [exportAt, setExportAt] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    void connectionSettings().then((value) => {
      setError('');
      setLogin(value.login ?? '');
      setDevice(value.deviceName);
      setConnected(value.connected);
    });
    void navigator.storage?.persisted?.().then(setPersistent);
    void getSetting('fontSize', 16).then(setFontSize);
    void getSetting<string | null>('lastExportAt', null).then(setExportAt);
  }, [open]);
  async function connect(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await connectServer(device);
      setLogin((await connectionSettings()).login ?? '');
      setConnected(true);
      notify('Tailscale로 연결했어요. 노트를 동기화합니다.');
    } catch (err) {
      setError(
        err instanceof Error && err.name !== 'TypeError'
          ? err.message
          : '인터넷 연결을 확인한 뒤 다시 연결해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(logout = false) {
    if (!(await finishEditing())) return;
    setBusy(true);
    try {
      await disconnectServer();
      if (logout) logoutTailscale();
      setConnected(false);
      window.dispatchEvent(new Event('note-lock'));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  async function backup() {
    if (!(await finishEditing())) return;
    setBusy(true);
    setError('');
    try {
      await exportNotebook();
      setExportAt(new Date().toISOString());
      notify('전체 백업 파일을 만들었어요.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '백업을 만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function restore(file: File) {
    setBusy(true);
    setError('');
    try {
      const count = await importNotebook(file);
      await refreshPending();
      notify(`${count}개의 노트를 사본으로 가져왔어요.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '백업을 가져오지 못했어요.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>나의 작업 공간</DialogTitle>
          <DialogDescription>
            연결, 백업, 쓰기 환경을 관리해요.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="connection">
          <TabsList className="settings-tabs">
            <TabsTrigger value="connection">동기화</TabsTrigger>
            <TabsTrigger value="data">내 기록</TabsTrigger>
            <TabsTrigger value="appearance">쓰기 환경</TabsTrigger>
          </TabsList>
          <TabsContent value="connection">
            <div className="connection-summary">
              <span
                className={`connection-symbol ${sync.nasAvailable ? 'connected' : ''}`}
              >
                {sync.nasAvailable ? <Cloud /> : <CloudOff />}
              </span>
              <div>
                <strong>
                  {sync.state === 'auth-required'
                    ? '다시 연결이 필요해요'
                    : sync.state === 'offline' || sync.state === 'error'
                      ? '서버 연결 대기'
                      : connected
                        ? 'Tailscale로 연결됨'
                        : '기기에만 저장 중'}
                </strong>
                <p>{sync.message}</p>
              </div>
              {connected && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="지금 동기화"
                  onClick={() => void syncNow()}
                  disabled={sync.state === 'syncing'}
                >
                  <RefreshCw
                    className={sync.state === 'syncing' ? 'spin' : ''}
                  />
                </Button>
              )}
            </div>
            {sync.lastSyncedAt && (
              <p className="settings-hint">
                마지막 동기화:{' '}
                {new Date(sync.lastSyncedAt).toLocaleString('ko-KR')}
              </p>
            )}
            <form onSubmit={connect} className="settings-form">
              <div className="settings-section">
                <h3>내장 Tailscale 연결</h3>
                <p>
                  별도 앱 없이 노트 안에서 암호화된 연결을 열어요. 본인 계정을
                  확인한 뒤 NAS에 동기화해요.
                </p>
                {connected && login && <small>연결 계정: {login}</small>}
              </div>
              <label>
                기기 이름
                <input
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  placeholder="나의 안드로이드"
                  maxLength={80}
                  required
                />
              </label>
              <div className="settings-button-row">
                <Button type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" /> : <Link2 />}
                  {connected ? 'Tailscale 연결 확인' : 'Tailscale로 연결'}
                </Button>
                {connected && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void disconnect()}
                    disabled={busy}
                  >
                    잠그기
                  </Button>
                )}
                {connected && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void disconnect(true)}
                    disabled={busy}
                  >
                    계정 로그아웃
                  </Button>
                )}
              </div>
            </form>
            <p className="settings-hint">
              <ShieldCheck size={14} />
              입력 즉시 기기에 저장하고, Tailscale을 통해서만 NAS에 동기화해요.
            </p>
          </TabsContent>
          <TabsContent value="data">
            <div className="settings-section">
              <h3>전체 백업</h3>
              <p>노트와 첨부 이미지를 하나의 파일에 담아요.</p>
              <Button
                variant="outline"
                onClick={() => void backup()}
                disabled={busy}
              >
                <Download />
                백업 파일 만들기
              </Button>
              {exportAt && (
                <small>
                  최근 백업: {new Date(exportAt).toLocaleString('ko-KR')}
                </small>
              )}
            </div>
            <div className="settings-section">
              <h3>백업 가져오기</h3>
              <p>기존 노트를 유지하고, 백업의 기록을 새 사본으로 추가해요.</p>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void restore(file);
                }}
              />
              <Button
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                <Upload />
                백업 파일 선택
              </Button>
            </div>
            <div className="settings-section">
              <h3>기기 저장소</h3>
              <p>오프라인 기록을 보관하는 공간이에요.</p>
              <Button
                variant="ghost"
                onClick={async () => {
                  const result = await navigator.storage?.persist?.();
                  setPersistent(Boolean(result));
                  notify(
                    result
                      ? '기기 저장소 보호가 활성화됐어요.'
                      : '브라우저가 저장소 보호를 허용하지 않았어요. 전체 백업을 함께 사용해 주세요.',
                  );
                }}
              >
                {persistent ? <Check /> : <HardDrive />}
                {persistent ? '저장소 보호 활성화됨' : '기기 저장소 보호 요청'}
              </Button>
              <small>
                브라우저의 사이트 데이터를 직접 삭제하면 기기에만 저장한 기록도
                삭제됩니다.
              </small>
            </div>
          </TabsContent>
          <TabsContent value="appearance">
            {!Capacitor.isNativePlatform() && (
              <section className="settings-section">
                <h3>안드로이드 앱</h3>
                <p>휴대폰에서도 같은 노트를 이어서 작성하세요.</p>
                <Button
                  variant="outline"
                  render={
                    <a
                      href={ANDROID_DOWNLOAD_URL}
                      aria-label="앱 설치 파일 받기"
                      download
                    />
                  }
                >
                  <Download size={16} /> 앱 설치 파일 받기
                </Button>
              </section>
            )}
            <div className="settings-section">
              <h3>앱과 오프라인 사용</h3>
              <p>
                {offline.ready
                  ? '작성 중에는 오프라인에서도 자동 저장해요. 앱을 다시 열 때는 Tailscale 연결을 확인합니다.'
                  : offline.unsupported
                    ? '이 브라우저에서 오프라인 준비를 마치지 못했어요. 연결된 상태에서 다시 열어 주세요.'
                    : '오프라인에서 사용할 화면을 준비하고 있어요.'}
              </p>
              {!Capacitor.isNativePlatform() && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void (offline.updateAvailable
                      ? applyOfflineUpdate()
                      : checkOfflineUpdate())
                  }
                >
                  <RefreshCw />
                  {offline.updateAvailable ? '새 버전 적용' : '업데이트 확인'}
                </Button>
              )}
            </div>
            <div className="settings-section">
              <h3>본문 글자 크기</h3>
              <p>편안하게 읽고 쓸 수 있는 크기를 선택하세요.</p>
              <div className="font-options">
                {[16, 18, 20, 22].map((size) => (
                  <Button
                    key={size}
                    variant={fontSize === size ? 'default' : 'outline'}
                    aria-pressed={fontSize === size}
                    onClick={() => {
                      setFontSize(size);
                      document.documentElement.style.setProperty(
                        '--editor-font-size',
                        `${size}px`,
                      );
                      void setSetting('fontSize', size);
                    }}
                  >
                    {size}
                  </Button>
                ))}
              </div>
              <p className="font-preview" style={{ fontSize }}>
                작은 생각이 모여 나의 기록이 됩니다.
              </p>
            </div>
            <div className="settings-section">
              <h3>키보드 단축키</h3>
              <dl className="shortcut-list">
                <div>
                  <dt>새 노트</dt>
                  <dd>Ctrl / ⌘ + Alt + N</dd>
                </div>
                <div>
                  <dt>노트 검색</dt>
                  <dd>Ctrl / ⌘ + K</dd>
                </div>
                <div>
                  <dt>굵게 / 기울임</dt>
                  <dd>Ctrl / ⌘ + B / I</dd>
                </div>
                <div>
                  <dt>동기화</dt>
                  <dd>Ctrl / ⌘ + S</dd>
                </div>
              </dl>
            </div>
          </TabsContent>
        </Tabs>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-version">
          <span className="gradient-text">노트</span>
          <span>v{APP_VERSION}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
