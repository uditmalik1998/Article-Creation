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

// MRP = rate + 30%, rounded up to the nearest multiple of 50.
export const calculateMrpFromRate = (rateOrCost: unknown): number => {
    const rate = parseNumericValue(rateOrCost);
    if (rate === null || rate <= 0) return 1;
    const withMargin = rate * 1.30;
    return Math.ceil(withMargin / 50) * 50;
};
