import { useEffect, useId, useRef } from 'react';

// Cards with their own Save button (B TRIM, V. ADD, PKG COST, CMP COST) register
// here while they hold unsaved changes. Save & Submit lists them in its confirm
// popup and saves them before sending the article to SAP.

export interface UnsavedCard {
  label: string;
  /** Runs the card's Save. Rejects if the save failed. */
  save: () => Promise<void>;
}

const cards = new Map<string, UnsavedCard>();

export const getUnsavedCards = (): UnsavedCard[] => Array.from(cards.values());

export function useRegisterUnsavedCard(label: string, unsaved: boolean, save: () => Promise<void>) {
  const id = useId();
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!unsaved) return;
    cards.set(id, { label, save: () => saveRef.current() });
    return () => { cards.delete(id); };
  }, [id, label, unsaved]);
}
