import { ensureTailscale } from './tailscale';
import { connectionSettings, connectServer, syncNow } from './sync';

export type ConnectionStage = 'account' | 'server' | 'opening';

export async function openNotebook(onStage: (stage: ConnectionStage) => void) {
  onStage('account');
  await ensureTailscale();
  onStage('server');
  const connection = await connectionSettings();
  await connectServer(connection.deviceName);
  onStage('opening');
  await syncNow();
}
