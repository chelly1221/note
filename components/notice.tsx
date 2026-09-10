'use client';
import { useEffect, useState } from 'react';
import { X, CircleCheck, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
type Notice = {
  message: string;
  error?: boolean;
  action?: { label: string; run: () => void };
  id: number;
};
export function notify(
  message: string,
  options: Omit<Notice, 'message' | 'id'> = {},
) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('note-notice', {
        detail: { message, ...options, id: Date.now() },
      }),
    );
}
export function NoticeHost() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const handler = (event: Event) =>
      setNotice((event as CustomEvent<Notice>).detail);
    window.addEventListener('note-notice', handler);
    return () => window.removeEventListener('note-notice', handler);
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div
      className={`notice ${notice.error ? 'notice-error' : ''}`}
      role={notice.error ? 'alert' : 'status'}
    >
      {notice.error ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
      <span>{notice.message}</span>
      {notice.action && (
        <Button
          variant="ghost"
          onClick={() => {
            notice.action?.run();
            setNotice(null);
          }}
        >
          {notice.action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="알림 닫기"
        onClick={() => setNotice(null)}
      >
        <X />
      </Button>
    </div>
  );
}
