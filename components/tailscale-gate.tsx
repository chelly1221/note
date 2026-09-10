'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ArrowRight,
  Check,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppDownloadLink } from '@/components/app-download-link';
import { Capacitor } from '@capacitor/core';
import { openAuthBrowser } from '@/lib/auth-browser';
import { getDb, initializeDatabase } from '@/lib/database';
import { openNotebook, type ConnectionStage } from '@/lib/connect-flow';
import { canOpenNotebookLocally } from '@/lib/local-session';
import { registerOfflineShell } from '@/lib/pwa';
import {
  getTailscaleSnapshot,
  getServerTailscaleSnapshot,
  subscribeTailscale,
  logoutTailscale,
} from '@/lib/tailscale';

export function TailscaleGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<ConnectionStage>('account');
  const [browserError, setBrowserError] = useState('');
  const native = Capacitor.isNativePlatform();
  function openAuthentication(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!native) return;
    event.preventDefault();
    setBrowserError('');
    void openAuthBrowser(event.currentTarget.href).catch((error) => {
      setBrowserError(
        error instanceof Error ? error.message : '인증 창을 다시 열어 주세요.',
      );
    });
  }
  const attempt = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const tunnel = useSyncExternalStore(
    subscribeTailscale,
    getTailscaleSnapshot,
    getServerTailscaleSnapshot,
  );

  function enter() {
    if (attempt.current) return attempt.current;
    setBusy(true);
    const current = generation.current;
    setError('');
    const work = (async () => {
      try {
        await openNotebook(setStage, () => current === generation.current);
        if (current === generation.current) setAllowed(true);
      } catch (failure) {
        if (current === generation.current) setError(
          failure instanceof Error && failure.name !== 'TypeError'
            ? failure.message
            : '내장 연결을 열지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
        );
      } finally {
        if (current === generation.current) { setBusy(false); attempt.current = null; }
      }
    })();
    attempt.current = work;
    return work;
  }

  useEffect(() => {
    let cancelled = false;
    void registerOfflineShell();
    void initializeDatabase(getDb(), { seedWelcome: false })
      .then(async () => {
        const local = await canOpenNotebookLocally();
        if (cancelled) return;
        if (local) setAllowed(true);
        setReady(true);
        // Existing notebooks are usable while the connection starts in the background.
        if (!cancelled) await enter();
      })
      .catch(() => {
        if (!cancelled) setReady(true);
        if (!cancelled)
          setError(
            '기기 저장소를 열지 못했어요. 브라우저의 저장 공간 설정을 확인해 주세요.',
          );
      });
    const lock = () => {
      generation.current++; attempt.current = null; setBusy(false);
      setAllowed(false);
      setStage('account');
      setError('');
    };
    window.addEventListener('note-lock', lock);
    return () => {
      cancelled = true;
      window.removeEventListener('note-lock', lock);
    };
  }, []);

  if (allowed) return children;
  if (!ready) return <main className="access-page"><output className="access-description">기기에 저장된 노트를 여는 중…</output></main>;
  const needsApproval =
    stage === 'account' && tunnel.state === 'NeedsMachineAuth';
  const loginReady =
    busy &&
    stage === 'account' &&
    tunnel.state === 'NeedsLogin' &&
    Boolean(tunnel.loginUrl);
  const activeStep = stage === 'account' ? 0 : stage === 'server' ? 1 : 2;
  const stepLabels = ['Tailscale 계정 인증', '노트 서버 연결', '노트 열기'];
  const guidance = needsApproval
    ? 'Tailscale 관리자 화면에서 이 기기를 승인해 주세요. 승인되면 자동으로 다음 단계로 넘어갑니다.'
    : loginReady
      ? native
        ? '아래 버튼에서 로그인하고 이 기기를 승인해 주세요. 인증을 마치면 창이 닫히고 자동으로 돌아옵니다.'
        : '아래 버튼에서 로그인하고 이 기기를 승인해 주세요. 인증을 마치면 이 화면으로 돌아오세요.'
      : stage === 'server'
        ? '인증한 계정으로 노트 서버에 접근할 수 있는지 확인하고 있어요.'
        : stage === 'opening'
          ? '저장된 기록을 확인하고 노트를 열고 있어요.'
          : busy
            ? '저장된 인증 정보를 확인하고 있어요. 처음 사용하는 기기라면 계정 인증 버튼이 나타납니다.'
            : '계정 인증부터 차례대로 안내해 드릴게요. 이미 인증한 기기는 자동으로 연결됩니다.';
  return (
    <main className="access-page">
      <section className="access-card" aria-label="Tailscale 연결">
        <div className="access-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="0" height="0" aria-hidden="true">
              <defs>
                <linearGradient
                  id="access-gradient"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="1"
                >
                  <stop stopColor="#b894ef" />
                  <stop offset=".4" stopColor="#ee8abd" />
                  <stop offset=".75" stopColor="#ef8d7b" />
                  <stop offset="1" stopColor="#edb17b" />
                </linearGradient>
              </defs>
            </svg>
            <Sparkles size={22} stroke="url(#access-gradient)" />
          </span>
          <span>노트</span>
        </div>
        <div className="access-symbol">
          <LockKeyhole size={24} />
        </div>
        <h1>
          {needsApproval
            ? '기기 승인이 필요해요.'
            : stage === 'account'
              ? '계정 인증부터 시작해요.'
              : stage === 'server'
                ? '서버에 연결하고 있어요.'
                : '노트를 열고 있어요.'}
        </h1>
        <ol className="connection-steps" aria-label="노트 시작 순서">
          {stepLabels.map((label, index) => (
            <li
              key={label}
              className={
                index === activeStep
                  ? 'current'
                  : index < activeStep
                    ? 'complete'
                    : ''
              }
              aria-current={index === activeStep ? 'step' : undefined}
            >
              <span className="connection-step-number" aria-hidden="true">
                {index < activeStep ? <Check size={14} /> : index + 1}
              </span>
              {label}
              {index < activeStep && <span className="sr-only">완료</span>}
            </li>
          ))}
        </ol>
        <output className="access-description" aria-live="polite">
          {guidance}
        </output>
        {loginReady ? (
          <a
            className="access-login account-action"
            href={tunnel.loginUrl}
            onClick={openAuthentication}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ShieldCheck size={18} aria-hidden="true" /> Tailscale 계정 인증하기{' '}
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        ) : needsApproval && busy ? (
          <a
            className="access-login account-action"
            href="https://console.tailscale.com/admin/machines"
            onClick={openAuthentication}
            target="_blank"
            rel="noopener noreferrer"
          >
            Tailscale에서 기기 승인하기{' '}
            <ArrowRight size={18} aria-hidden="true" />
          </a>
        ) : (
          <Button
            className="access-connect"
            onClick={() => {
              if (tunnel.state === 'Error') location.reload();
              else void enter();
            }}
            disabled={!ready || busy}
          >
            {busy || !ready ? (
              <LoaderCircle className="spin" />
            ) : (
              <ShieldCheck />
            )}
            {!ready
              ? '시작 준비 중'
              : busy
                ? stage === 'account'
                  ? '계정 인증 준비 중'
                  : stage === 'server'
                    ? '서버 연결 확인 중'
                    : '노트 여는 중'
                : error
                  ? '다시 시도'
                  : '노트 연결 시작'}
          </Button>
        )}
        {loginReady && (
          <p className="access-help">
            {native
              ? '앱 안의 인증 창에서 진행합니다. 완료되면 자동으로 닫힙니다.'
              : '새 창에서 인증합니다. 완료 여부는 자동으로 확인하므로 다시 로그인할 필요가 없어요.'}
          </p>
        )}
        {browserError && (
          <p className="access-error" role="alert">
            {browserError}
          </p>
        )}
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        {error && tunnel.state === 'Running' && (
          <Button
            variant="ghost"
            onClick={() => {
              logoutTailscale();
              setStage('account');
              setError('');
            }}
          >
            다른 계정으로 로그인
          </Button>
        )}
        <p className="access-help">
          Tailscale 앱을 따로 설치하지 않아도 됩니다.
        </p>
        <AppDownloadLink className="access-download app-download-link" />
        <div className="access-footer">
          <span className="gradient-stroke" />
          입력 즉시 자동 저장 · NAS 동기화
        </div>
      </section>
    </main>
  );
}
