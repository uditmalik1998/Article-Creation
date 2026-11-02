// In-app "leave this page?" guard. BrowserRouter has no navigation blocker, so the
// places that navigate away (sidebar, article page back / ◀ ▶) call guardLeave().
// A page with unsaved work registers a guard that decides whether to proceed now
// or ask the user first (and call proceed later).

type LeaveGuard = (proceed: () => void) => boolean; // true = handled (will call proceed itself, or not)

let activeGuard: LeaveGuard | null = null;

export function registerLeaveGuard(guard: LeaveGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** Runs `proceed` now, unless the active guard takes over (e.g. shows an unsaved-changes popup). */
export function guardLeave(proceed: () => void): void {
  if (activeGuard && activeGuard(proceed)) return;
  proceed();
}
