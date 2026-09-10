import type { Metadata } from 'next';
import './globals.css';
import { WebUpdateBanner } from '@/components/web-update-banner';
export const metadata: Metadata = {
  title: '노트',
  description: '생각을 기록하고, 어디서든 이어 쓰는 나만의 노트.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico?v=0.2.3', sizes: '16x16 32x32' },
      { url: '/favicon-32.png?v=0.2.3', type: 'image/png', sizes: '32x32' },
      { url: '/favicon.svg?v=0.2.3', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: '/icon-192.png?v=0.2.3',
  },
};
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111111',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body>
        {children}
        <WebUpdateBanner />
      </body>
    </html>
  );
}
