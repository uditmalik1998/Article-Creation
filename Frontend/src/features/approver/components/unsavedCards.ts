import { useEffect, useId, useRef } from 'react';

// Cards with their own Save button (B TRIM, V. ADD, PKG COST, CMP COST) register
// here while they hold unsaved changes. Save & Submit lists them in its confirm
// popup and saves them before sending the article to SAP; leaving the page asks
// Save & leave / Leave without saving.

export interface UnsavedCard {
  label: string;
  /** Runs the card's Save. Rejects if the save failed. */
  save: () => Promise<void>;
  /** "Leave without saving": drops the card's local draft too. */
  discardDraft?: () => void;
  /** The user typed something (not just master auto-fill) — only these trigger the leave popup. */
  userEdited: boolean;
}

const cards = new Map<string, UnsavedCard>();

export const getUnsavedCards = (): UnsavedCard[] => Array.from(cards.values());
export const getUserEditedCards = (): UnsavedCard[] => getUnsavedCards().filter((c) => c.userEdited);

export function useRegisterUnsavedCard(
  label: string,
  unsaved: boolean,
  save: () => Promise<void>,
  discardDraft?: () => void,
  userEdited = true,
) {
  const id = useId();
  const saveRef = useRef(save);
  saveRef.current = save;
  const discardRef = useRef(discardDraft);
  discardRef.current = discardDraft;
  useEffect(() => {
    if (!unsaved) return;
    cards.set(id, { label, save: () => saveRef.current(), discardDraft: () => discardRef.current?.(), userEdited });
    return () => { cards.delete(id); };
  }, [id, label, unsaved, userEdited]);
}
