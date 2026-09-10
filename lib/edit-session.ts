let guard: (() => Promise<boolean>) | undefined;
export function registerEditGuard(callback: () => Promise<boolean>) {
  guard = callback;
  return () => {
    if (guard === callback) guard = undefined;
  };
}
export async function finishEditing() {
  return guard ? guard() : true;
}
