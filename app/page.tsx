import NoteWorkspace from '@/components/note-workspace';
import { TailscaleGate } from '@/components/tailscale-gate';
export default function Home() {
  return (
    <TailscaleGate>
      <NoteWorkspace />
    </TailscaleGate>
  );
}
