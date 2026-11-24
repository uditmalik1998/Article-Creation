/**
 * extraction_results_flat.fg_ai_attributes (2026-11-24) — what the AI picked for each
 * FG FAB / BODY card attribute at extraction time, kept apart from the editable value
 * columns so the card's "AI result" column still shows it after a user changes a value.
 *
 * Flat JSON keyed by the card's schema key, every key present (null = AI gave nothing):
 *   {"yarn_01":"C","weave":"POP","neck":"RN","fit":null, …}
 * Read by FG ApproverArticleList (FG_AI_KEY = attr.schemaKey). Written only by the two
 * extraction paths (SRM / raw-articles VLM, manual extraction page); never by page saves.
 */

/** [flat row field, card schema key] — FAB + BODY card attributes the VLM can fill. */
export const FG_AI_FIELDS: [string, string][] = [
  // FAB
  ['fabDiv', 'fab_div'],
  ['yarn1', 'yarn_01'],
  ['mainMvgr', 'main_mvgr'],
  ['fabricMainMvgr', 'fabric_main_mvgr'],
  ['weave', 'weave'],
  ['mFab2', 'm_fab2'],
  ['fCount', 'f_count'],
  ['gsm', 'gsm'],
  ['fOunce', 'f_ounce'],
  ['fConstruction', 'f_construction'],
  ['composition', 'composition'],
  ['finish', 'finish'],
  ['fWidth', 'f_width'],
  ['lycra', 'lycra_non_lycra'],
  // BODY
  ['collar', 'collar'],
  ['collarStyle', 'collar_style'],
  ['neckDetails', 'neck_details'],
  ['neck', 'neck'],
  ['placket', 'placket'],
  ['fatherBelt', 'father_belt'],
  ['childBelt', 'child_belt'],
  ['sleeve', 'sleeve'],
  ['sleeveFold', 'sleeve_fold'],
  ['mSet', 'set'],
  ['bottomFold', 'bottom_fold'],
  ['noOfPocket', 'no_of_pocket'],
  ['pocketType', 'pocket_type'],
  ['extraPocket', 'extra_pocket'],
  ['fit', 'fit'],
  ['pattern', 'body_style'],
  ['length', 'length'],
];

/** Prisma select for the fields above (to read back a freshly extracted flat row). */
export const FG_AI_SELECT: Record<string, true> = Object.fromEntries(FG_AI_FIELDS.map(([f]) => [f, true]));

/** Build the fg_ai_attributes JSON from AI values keyed by flat field name. */
export function buildFgAiAttributes(values: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(
    FG_AI_FIELDS.map(([field, key]) => {
      const v = values[field];
      const s = v == null ? '' : String(v).trim();
      return [key, s === '' ? null : s];
    }),
  );
}
