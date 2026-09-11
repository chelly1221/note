import { ensureTailscale, getTailscaleSnapshot, subscribeTailscale, suspendTailscale } from "./tailscale";

export type BackgroundOutcome = "ok" | "auth" | "skipped" | "retry";
export async function runBackgroundSync(admitted: () => Promise<boolean>, sync: () => Promise<boolean>, after?: () => Promise<void>): Promise<BackgroundOutcome> {
  if (!(await admitted())) return "skipped";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  try {
    await Promise.race([
      ensureTailscale(),
      new Promise<never>((_, reject) => {
        const inspect = () => {
          if (["NeedsLogin", "NeedsMachineAuth"].includes(getTailscaleSnapshot().state)) reject(new Error("auth"));
        };
        stop = subscribeTailscale(inspect);inspect();
        timer = setTimeout(() => reject(new Error("timeout")), 45000);
      }),
    ]);
    if (!(await admitted())) return "skipped";
    const ok = await sync();
    if (after) await after();
    return ok ? "ok" : "retry";
  } catch (error) {
    return error instanceof Error && error.message === "auth" ? "auth" : "retry";
  } finally {
    clearTimeout(timer);stop();suspendTailscale();
  }
}
