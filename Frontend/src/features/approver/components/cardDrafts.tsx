import { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';

// Local (browser-only) drafts of the FG New-article costing cards (CMP COST, B TRIM,
// V. ADD, PKG COST). An edit is copied to localStorage — no API call — so a closed tab,
// a crash or leaving without saving loses nothing; reopening the article offers
// Restore / Discard. A draft is removed when the card is saved, when the article is
// approved or rejected, on Discard, or after 7 days.

const PREFIX = 'fgCardDraft:v1:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WRITE_DELAY_MS = 400;

interface StoredDraft<T> {
  savedAt: number;
  data: T;
}

const keyFor = (articleId: string, cardKey: string) => `${PREFIX}${articleId}:${cardKey}`;

const read = <T,>(key: string): StoredDraft<T> | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const remove = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
};

/** Drops every card draft of these articles (approved / rejected). */
export function clearArticleDrafts(articleIds: string[]): void {
  try {
    const prefixes = articleIds.map((id) => `${PREFIX}${id}:`);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}

// Once per page load: drop drafts older than 7 days.
(() => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) read(k);
    }
  } catch {
    /* storage unavailable */
  }
})();

/**
 * Keeps a card's unsaved state in localStorage while `active` (the user has edited it),
 * and offers the stored draft once when the card opens for `articleId`.
 * No `articleId` (Created page / locked article) → drafts are off.
 */
export function useCardDraft<T>(articleId: string | undefined, cardKey: string, active: boolean, data: T) {
  const key = articleId ? keyFor(articleId, cardKey) : null;
  const [pending, setPending] = useState<StoredDraft<T> | null>(null);

  useEffect(() => {
    setPending(key ? read<T>(key) : null);
  }, [key]);

  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (!key || !active) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: dataRef.current }));
      } catch {
        /* storage full / unavailable — drafts are best effort */
      }
    }, WRITE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [key, active, data]);

  const clearDraft = useCallback(() => {
    if (key) remove(key);
    setPending(null);
  }, [key]);

  /** Hides the banner after Restore (the draft keeps being updated while the user edits). */
  const dismissPending = useCallback(() => setPending(null), []);

  return { pendingDraft: pending, clearDraft, dismissPending };
}

export const DraftRestoreBanner: React.FC<{ savedAt: number; onRestore: () => void; onDiscard: () => void }> = ({
  savedAt,
  onRestore,
  onDiscard,
}) => (
  <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-900">
    <History className="h-3.5 w-3.5 shrink-0" />
    <span className="flex-1">
      Unsaved changes from{' '}
      <b>{new Date(savedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>{' '}
      were kept on this computer.
    </span>
    <button
      type="button"
      onClick={onRestore}
      className="h-6 rounded-md bg-slate-800 px-2.5 text-[11.5px] font-bold text-white hover:bg-slate-900"
    >
      Restore
    </button>
    <button
      type="button"
      onClick={onDiscard}
      className="h-6 rounded-md border border-amber-300 bg-white px-2.5 text-[11.5px] font-semibold text-amber-900 hover:bg-amber-100"
    >
      Discard
    </button>
  </div>
);
