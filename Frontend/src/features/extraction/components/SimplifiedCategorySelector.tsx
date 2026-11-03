/**
 * Division → sub-division lists and the selected-category shape, shared by the
 * extraction and article pages.
 */
export const SIMPLIFIED_HIERARCHY: Record<string, string[]> = {
  Kids: ['KB-SETS', 'KB-L', 'KB-U', 'KBW-U', 'KBW-L', 'KBW-SETS', 'KG-L', 'KG-U', 'KGW-U', 'KGW-L', 'IB', 'IG', 'KI', 'KIW', 'KB', 'KBW', 'KG'],
  Ladies: ['LU', 'LL', 'LK&L', 'LN&L', 'LW'],
  MENS: ['MU', 'MS-U', 'MS-L', 'MW', 'MO', 'MS-IW', 'ML'],
};

export interface SimplifiedCategory {
  department: string;
  majorCategory: string;
  displayName: string;
}
