'use client';
import BackgroundSyncSettings from './background-sync-settings';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Download,
  Upload,
  Link2,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  connectionSettings,
  connectServer,
  disconnectServer,
  refreshPending,
} from '@/lib/sync';
import { exportNotebook, importNotebook } from '@/lib/export';
import {
  logoutTailscale,
  getTailscaleSnapshot,
  getServerTailscaleSnapshot,
  subscribeTailscale,
} from '@/lib/tailscale';
import { openAuthBrowser } from '@/lib/auth-browser';
import { notify } from '@/components/notice';
import { APP_VERSION } from '@/lib/model';
import { finishEditing } from '@/lib/edit-session';
import { Capacitor } from '@capacitor/core';

export function SettingsDialog({
  open,
  onOpenChange,
  embedded = false,
}: {
  embedded?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tunnel = useSyncExternalStore(
    subscribeTailscale,
    getTailscaleSnapshot,
    getServerTailscaleSnapshot,
  );
  const loginUrl =
    tunnel.loginUrl ||
    (tunnel.state === 'NeedsMachineAuth'
      ? 'https://console.tailscale.com/admin/machines'
      : '');
  const [login, setLogin] = useState('');
  const [device, setDevice] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    void connectionSettings().then((value) => {
      setError('');
      setLogin(value.login ?? '');
      setDevice(value.deviceName);
      setConnected(value.connected);
    });
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
  const content = <>
        <div className="settings-sections">
          <section className="settings-connection-section" aria-label="서버 연결">
            <BackgroundSyncSettings />
            {loginUrl && (
              <a
                className="access-login"
                href={loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (Capacitor.isNativePlatform()) {
                    event.preventDefault();
                    void openAuthBrowser(loginUrl).catch((err) =>
                      setError(String(err)),
                    );
                  }
                }}
              >
                동기화를 위해 Tailscale 다시 인증
              </a>
            )}
            <form onSubmit={connect} className="settings-form">
              {connected && login && (
                <p className="settings-hint">연결 계정: {login}</p>
              )}
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
          </section>
          <div className="settings-data-section">
            <div className="settings-section">
              <Button
                variant="outline"
                onClick={() => void backup()}
                disabled={busy}
              >
                <Download />
                백업 만들기
              </Button>
            </div>
            <div className="settings-section">
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
                백업 가져오기
              </Button>
            </div>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-version">
          <span className="gradient-text">노트</span>
          <span>v{APP_VERSION}</span>
        </div>
  </>;
  if (embedded) return open ? <section id="note-settings-panel" className="settings-dialog embedded-settings" aria-labelledby="note-settings-title"><header className="settings-page-header"><h2 id="note-settings-title">설정</h2></header><div className="settings-page-content">{content}</div></section> : null;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>설정</DialogTitle><DialogDescription className="sr-only">서버 연결과 백업을 관리해요.</DialogDescription></DialogHeader>{content}</DialogContent></Dialog>;
}
