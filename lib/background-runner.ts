import { ensureTailscale, getTailscaleSnapshot, subscribeTailscale, suspendTailscale } from "./tailscale";

export type BackgroundOutcome = "ok" | "auth" | "skipped" | "retry";
export async function runBackgroundSync(admitted: () => Promise<boolean>, sync: () => Promise<boolean>, after?: () => Promise<void>): Promise<BackgroundOutcome> {
  if (!(await admitted())) return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const controller = new AbortController();
  try {
    await Promise.race([
      ensureTailscale(controller.signal, false),
      new Promise<never>((_, reject) => {
        const inspect = () => {
          if (["NeedsLogin", "NeedsMachineAuth"].includes(getTailscaleSnapshot().state)) reject(new Error("auth"));
        };
        stop = subscribeTailscale(inspect);inspect();
        timer = setTimeout(() => reject(new Error("timeout")), 45000);
      }),
    ]);
    clearTimeout(timer); stop(); stop = () => {};
    if (!(await admitted())) return "skipped";
    const ok = await sync();
    if (after) await after();
    return ok ? "ok" : "retry";
  } catch (error) {
    return ["NeedsLogin", "NeedsMachineAuth"].includes(getTailscaleSnapshot().state) || (error instanceof Error && error.message === "auth") ? "auth" : "retry";
  } finally {
    clearTimeout(timer);stop();controller.abort();suspendTailscale();
  }
}
