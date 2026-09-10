'use client';
import { Component, type ReactNode } from 'react';
import { CloudOff } from 'lucide-react';
import { Button } from './ui/button';

export class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="storage-error-page">
        <CloudOff size={36} />
        <h1>작업 공간을 열지 못했어요.</h1>
        <p>
          다시 열어 기기에 저장된 기록을 불러오세요.
          <br />
          계속된다면 브라우저의 저장소 사용이 허용되어 있는지 확인해 주세요.
        </p>
        <Button onClick={() => location.reload()}>다시 열기</Button>
      </main>
    );
  }
}
