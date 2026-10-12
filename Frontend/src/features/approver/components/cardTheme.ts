// One theme for every attribute card on the approver article view
// ("Ink Header", 2026-10-12): dark slate header bar with light text, white
// body, light slate card border. Tab chips use the same bg/fg when active.
export const CARD_THEME = {
  bg: '#1e293b', // header bar (slate-800)
  fg: '#f8fafc', // header text/icons (slate-50)
  border: '#cbd5e1', // card outline (slate-300)
} as const;

// Full-width action buttons inside cards (Create Fabric Article, Create Body
// Article): light slate at rest, hover fills with the header slate.
export const CARD_ACTION_BTN =
  'h-7 w-full border border-slate-300 bg-slate-50 text-[11px] font-medium text-slate-700 ' +
  'hover:border-slate-800 hover:bg-slate-800 hover:text-slate-50 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
