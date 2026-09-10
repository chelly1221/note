'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDb, initializeDatabase } from '@/lib/database';
import { connectionSettings, connectServer, syncNow } from '@/lib/sync';
import { registerOfflineShell } from '@/lib/pwa';

export function TailscaleGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<Promise<void> | null>(null);

  function enter() {
    if (attempt.current) return attempt.current;
    setBusy(true);
    setError('');
    const work = (async () => {
      try {
        const connection = await connectionSettings();
        await connectServer(connection.deviceName);
        await syncNow();
        setAllowed(true);
      } catch (failure) {
        setError(
          failure instanceof Error && failure.name !== 'TypeError'
            ? failure.message
            : 'Tailscale 앱에 로그인하고 연결을 켜 주세요. 브라우저가 로컬 네트워크 접근을 요청하면 허용해 주세요.',
        );
      } finally {
        setBusy(false);
        attempt.current = null;
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
        if (cancelled) return;
        setReady(true);
        const connection = await connectionSettings();
        if (connection.connected && !cancelled) await enter();
      })
      .catch(() => {
        if (!cancelled)
          setError(
            '기기 저장소를 열지 못했어요. 브라우저의 저장 공간 설정을 확인해 주세요.',
          );
      });
    const lock = () => setAllowed(false);
    window.addEventListener('note-lock', lock);
    return () => {
      cancelled = true;
      window.removeEventListener('note-lock', lock);
    };
  }, []);

  if (allowed) return children;
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
          나의 기록으로
          <br />
          들어가요.
        </h1>
        <p className="access-description">
          Tailscale로 연결된 나만의 공간.
          <br />
          생각은 가볍게, 기록은 안전하게.
        </p>
        <Button
          className="access-connect"
          onClick={() => void enter()}
          disabled={!ready || busy}
        >
          {busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}
          {busy ? 'Tailscale 확인 중' : 'Tailscale로 연결'}
          {!busy && <ArrowRight />}
        </Button>
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <p className="access-help">
          이 기기에서 Tailscale에 로그인하고 연결을 켜 주세요.
        </p>
        <a
          href="https://tailscale.com/download"
          target="_blank"
          rel="noreferrer"
        >
          Tailscale 설치 안내 <span aria-hidden="true">↗</span>
        </a>
        <div className="access-footer">
          <span className="gradient-stroke" />
          입력 즉시 자동 저장 · NAS 동기화
        </div>
      </section>
    </main>
  );
}
