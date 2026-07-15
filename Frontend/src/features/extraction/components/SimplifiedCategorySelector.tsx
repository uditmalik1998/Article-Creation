/**
 * Simplified Category Selector — DB-driven
 * Fetches departments and categories from the hierarchy API.
 * Falls back to hardcoded data if the API is unavailable.
 *
 * If the user's role has a division pre-assigned (CREATOR etc.), the Division
 * field is shown as a read-only label — no dropdown needed.
 * Only the Sub-Division dropdown is shown for selection.
 * A "Continue to Upload →" button appears once Sub-Division is chosen.
 */
import { useState, useEffect, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
} from '@/shared/components/ui-tw';
import { APP_CONFIG } from '../../../constants/app/config';

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

interface SimplifiedCategorySelectorProps {
  onCategorySelect: (category: SimplifiedCategory | null) => void;
  selectedCategory?: SimplifiedCategory | null;
}

const normalizeDivision = (division?: string): string | null => {
  if (!division) return null;
  const upper = division.toUpperCase();
  if (upper === 'MEN' || upper === 'MENS') return 'MENS';
  if (upper === 'KIDS') return 'Kids';
  if (upper === 'LADIES') return 'Ladies';
  return division;
};

// Parse a potentially comma-separated division string into normalized division names.
const parseDivisionList = (raw: unknown): string[] => {
  if (!raw) return [];
  const parts = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
  return parts.map((p) => normalizeDivision(p) ?? p);
};

const parseSubDivisions = (rawSubDivision: unknown): string[] => {
  if (Array.isArray(rawSubDivision)) return rawSubDivision.map((v) => String(v).trim()).filter(Boolean);
  if (typeof rawSubDivision === 'string') return rawSubDivision.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
};

export const SimplifiedCategorySelector: React.FC<SimplifiedCategorySelectorProps> = ({
  onCategorySelect,
  selectedCategory,
}) => {
  const [selectedDepartment, setSelectedDepartment] = useState<string | undefined>(selectedCategory?.department);
  // Sub-division is now selected in Step 2 (Upload page), not here

  const [hierarchy, setHierarchy] = useState<Record<string, string[]>>(SIMPLIFIED_HIERARCHY);
  const [hierarchyLoading, setHierarchyLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/user/hierarchy`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.data?.departments?.length) return;
        const apiMap: Record<string, string[]> = {};
        for (const dept of data.data.departments) {
          if (!dept.categories?.length) continue;
          const key = normalizeDivision(dept.name) || dept.name;
          // Each category entry carries `subDepartmentCode` (e.g. "MU", "MW", "LU")
          // which is the actual sub-division code from the SubDepartment table.
          // Using c.code would give major-category codes (e.g. "MW_LW_JKT_FS") — wrong.
          const incoming = [
            ...new Set(
              (dept.categories as any[]).map((c: any) => String(c.subDepartmentCode ?? '').trim()).filter(Boolean),
            ),
          ];
          if (incoming.length === 0) continue;
          const existing = apiMap[key] || [];
          apiMap[key] = [...new Set([...existing, ...incoming])];
        }
        // Always merge API result with hardcoded fallback
        const merged: Record<string, string[]> = { ...SIMPLIFIED_HIERARCHY };
        for (const [key, codes] of Object.entries(apiMap)) {
          merged[key] = [...new Set([...(SIMPLIFIED_HIERARCHY[key] || []), ...codes])];
        }
        setHierarchy(merged);
      })
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => setHierarchyLoading(false));
  }, []);

  // Pre-fill division from user profile if not yet chosen
  const creatorScope = useMemo(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const isCreator = user.role === 'CREATOR';
    const divisionList = parseDivisionList(user.division);
    // Single division → auto-select and lock. Multiple → user must pick from their list.
    const defaultDivision = divisionList.length === 1 ? divisionList[0] : null;
    const allowedDivisions = divisionList; // empty = no restriction (show all)
    const allowedSubDivisions = parseSubDivisions(user.subDivision);
    return { isCreator, defaultDivision, allowedDivisions, allowedSubDivisions };
  }, []);

  useEffect(() => {
    if (creatorScope.defaultDivision && !selectedDepartment) {
      setSelectedDepartment(creatorScope.defaultDivision);
    }
  }, [creatorScope.defaultDivision, selectedDepartment]);

  const departments = Object.keys(hierarchy);

  const handleDepartmentChange = (value: string) => {
    setSelectedDepartment(value);
    onCategorySelect(null);
  };

  const handleContinue = () => {
    if (!selectedDepartment) return;
    // Sub-division is chosen in Step 2; pass empty string here, it gets filled later
    onCategorySelect({
      department: selectedDepartment,
      majorCategory: '',
      displayName: selectedDepartment,
    });
  };

  // Single assigned division → show as read-only. Multiple → show restricted dropdown.
  const hasPinnedDivision = !!creatorScope.defaultDivision;
  const hasMultipleDivisions = creatorScope.allowedDivisions.length > 1;
  const canContinue = !!selectedDepartment;

  // Departments shown in the dropdown: restrict to user's assigned divisions when applicable.
  const visibleDepartments = hasMultipleDivisions
    ? departments.filter((d) => creatorScope.allowedDivisions.includes(d))
    : departments;

  return (
    <Spinner spinning={hierarchyLoading} tip="Loading categories...">
      <div className="grid gap-5">
        {/* Division — read-only for single-division users, restricted dropdown for multi-division */}
        <div>
          <span className="mb-2 block text-sm font-semibold">1. Division</span>
          {hasPinnedDivision ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3.5 py-2.5 text-base font-medium">
              <span className="text-xs text-muted-foreground">Auto-filled from your role:</span>
              <strong>{selectedDepartment}</strong>
            </div>
          ) : (
            <Select value={selectedDepartment ?? ''} onValueChange={handleDepartmentChange} disabled={hierarchyLoading}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder="Select Division (Kids, Ladies, MENS)" />
              </SelectTrigger>
              <SelectContent>
                {visibleDepartments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Separator className="my-1" />

        <Button
          size="lg"
          disabled={!canContinue}
          onClick={handleContinue}
          className="h-12 w-full text-base font-semibold"
          style={
            canContinue
              ? { background: 'linear-gradient(135deg, #7DB9B6 0%, #E6C79C 100%)', border: 'none' }
              : undefined
          }
        >
          <ArrowRight />
          {canContinue
            ? `Continue to Upload → ${selectedDepartment}`
            : 'Select Division to continue'}
        </Button>
      </div>
    </Spinner>
  );
};
