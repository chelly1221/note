import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'kr.threechan.note',
  appName: '노트',
  webDir: 'dist/client',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: {
    backgroundColor: '#111111',
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    Keyboard: { resize: 'body', resizeOnFullScreen: true },
    SplashScreen: { launchShowDuration: 0 },
  },
};
export default config;
