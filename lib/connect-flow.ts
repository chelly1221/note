import { ensureTailscale } from './tailscale';
import { connectionSettings, connectServer, syncNow } from './sync';

export type ConnectionStage = 'account' | 'server' | 'opening';

export async function openNotebook(onStage: (stage: ConnectionStage) => void, isActive: () => boolean = () => true) {
  onStage('account');
  await ensureTailscale();
  if (!isActive()) return;
  onStage('server');
  const connection = await connectionSettings();
  if (!isActive()) return;
  await connectServer(connection.deviceName);
  if (!isActive()) return;
  onStage('opening');
  await syncNow();
}
