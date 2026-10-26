/**
 * Hierarchy Management Page
 * Tab 1: Grid Values
 * Tab 2: Size Master
 * Tab 3: Hierarchy — division / sub-division / major category (major_category_details)
 *
 * Layout (design "Option A · ink header"): one dark slate header holding the title and the
 * underline tabs; the active tab's card attaches directly under it.
 */
import { useState, type ReactNode } from 'react';
import { Network, ListTree, Ruler, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HierarchyTreeEditor } from '../components/HierarchyTreeEditor';
import { GridValuesEditor } from '../components/GridValuesEditor';
import { SizeMasterEditor } from '../components/SizeMasterEditor';

type TabType = 'grid-values' | 'size-master' | 'hierarchy';

const TABS: { key: TabType; label: string; icon: LucideIcon; help: ReactNode }[] = [
  {
    key: 'grid-values',
    label: 'Grid Values',
    icon: ListTree,
    help: (
      <>
        Pick an <strong>attribute</strong>, then a <strong>major category</strong>, and edit its allowed values on
        the right. Every add or remove asks for a reason.
      </>
    ),
  },
  {
    key: 'size-master',
    label: 'Size Master',
    icon: Ruler,
    help: (
      <>
        Pick a <strong>major category</strong> on the left and edit its sizes on the right — every add or remove
        needs a reason and is recorded with your name in the history.
      </>
    ),
  },
  {
    key: 'hierarchy',
    label: 'Hierarchy',
    icon: Network,
    help: (
      <>
        From <strong>major_category_details</strong>: pick a <strong>division</strong> tab, then a{' '}
        <strong>sub-division</strong> card to see and edit its major categories (MC code, HSN, status). Use the{' '}
        <strong>pencil</strong> to rename or edit.
      </>
    ),
  },
];

export default function HierarchyManagement() {
  const [activeTab, setActiveTab] = useState<TabType>('grid-values');
  const active = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  return (
    <div className="page-scroll-enabled min-h-screen">
      <div className="p-6">
        <div className="mx-auto max-w-[1600px]">
          {/* Ink header: title + underline tabs */}
          <header className="rounded-t-2xl bg-slate-800 px-6 pt-5 text-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">ADMIN PANEL</span>
                <h1 className="m-0 mt-0.5 text-2xl font-semibold">Hierarchy Management</h1>
                <p className="mt-1 text-sm text-slate-300">
                  Departments, categories &amp; extraction attributes — changes reflect in the app within 5 minutes
                </p>
              </div>
            </div>

            <nav role="tablist" aria-label="Hierarchy sections" className="mt-4 flex gap-6 overflow-x-auto">
              {TABS.map(({ key, label, icon: Icon }) => {
                const on = key === activeTab;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`hier-tab-${key}`}
                    aria-selected={on}
                    aria-controls={`hier-panel-${key}`}
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      'relative inline-flex h-11 shrink-0 items-center gap-2 px-1 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
                      "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                      on
                        ? 'font-semibold text-white after:bg-slate-400'
                        : 'text-slate-300 after:bg-transparent hover:text-white hover:after:bg-slate-600',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </nav>
          </header>

          {/* Active tab — attached to the header */}
          <section
            role="tabpanel"
            id={`hier-panel-${active.key}`}
            aria-labelledby={`hier-tab-${active.key}`}
            className="rounded-b-2xl border border-t-0 border-slate-200 bg-white px-6 pb-6 pt-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <p className="mb-3 text-sm text-muted-foreground">{active.help}</p>
            {activeTab === 'grid-values' && <GridValuesEditor />}
            {activeTab === 'size-master' && <SizeMasterEditor />}
            {activeTab === 'hierarchy' && <HierarchyTreeEditor />}
          </section>
        </div>
      </div>
    </div>
  );
}
