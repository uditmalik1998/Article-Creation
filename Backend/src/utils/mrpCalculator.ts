export const parseNumericValue = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const cleaned = String(value)
        .replace(/[₹$€£¥,]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\/-$/, '')
        .replace(/\/$/, '')
        .replace(/-$/, '')
        .trim();

    const match = cleaned.match(/-?\d+(\.\d+)?/);
    if (!match) return null;

    const parsed = parseFloat(match[0]);
    return Number.isNaN(parsed) ? null : parsed;
};

export const MRP_MARGIN_MULTIPLIER = 1.47;
// 50, never 25: the step also sets the cost ceiling (MRP x 0.79).
export const MRP_ROUNDING_STEP = 50;

// MRP = rate + 47%, rounded up to the nearest multiple of 50.
// Keep in step with Frontend/src/shared/utils/common/pricing.ts.
export const calculateMrpFromRate = (rateOrCost: unknown): number => {
    const rate = parseNumericValue(rateOrCost);
    if (rate === null || rate <= 0) return 1;
    const withMargin = rate * MRP_MARGIN_MULTIPLIER;
    return Math.ceil(withMargin / MRP_ROUNDING_STEP) * MRP_ROUNDING_STEP;
};
