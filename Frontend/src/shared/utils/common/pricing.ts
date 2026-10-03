// Single source of truth for MRP derivation.
//
// MRP is calculated FROM the cost/rate; cost is never derived from MRP.
// Keep this in step with Backend/src/utils/mrpCalculator.ts - the two must
// agree, or the same article gets a different MRP depending on which side
// last saved it.

// MRP = rate + 47%.
export const MRP_MARGIN_MULTIPLIER = 1.47;

// ...then rounded UP to the next multiple of this step.
// 50, never 25: the step also sets the cost ceiling (MRP x 0.79) that the PO
// is allowed to carry, so a smaller step silently tightens it.
export const MRP_ROUNDING_STEP = 50;

export const calculateMrpFromRate = (rate: number): number =>
  Math.ceil((rate * MRP_MARGIN_MULTIPLIER) / MRP_ROUNDING_STEP) * MRP_ROUNDING_STEP;
