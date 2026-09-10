'use client';
import { Capacitor } from '@capacitor/core';
import { Download } from 'lucide-react';
import { ANDROID_DOWNLOAD_URL } from '@/lib/model';

export function AppDownloadLink({ className }: { className?: string }) {
  if (Capacitor.isNativePlatform()) return null;
  return (
    <a
      className={className}
      href={ANDROID_DOWNLOAD_URL}
      download
      title="안드로이드 앱 설치 파일(APK) 다운로드"
    >
      <Download size={17} aria-hidden="true" />
      안드로이드 앱 다운로드
    </a>
  );
}
