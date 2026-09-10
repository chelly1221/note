import { connectionSettings } from './sync';

/** A cached, unlocked notebook opens independently of network or account availability. */
export async function canOpenNotebookLocally() {
  const settings = await connectionSettings();
  return settings.connected === true;
}
