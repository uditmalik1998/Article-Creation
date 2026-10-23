import { Request, Response } from 'express';
import { prismaClient as prisma } from '../utils/prisma';

// Maps masterAttribute.key (schema key) → extractionResultFlat column name (dbField)
// This is the backend counterpart of SCHEMA_KEY_TO_DB_FIELD in the frontend.
const SCHEMA_KEY_TO_DB_FIELD: Record<string, string> = {
  macro_mvgr: 'macroMvgr', main_mvgr: 'mainMvgr', yarn_01: 'yarn1',
  fabric_main_mvgr: 'fabricMainMvgr', weave: 'weave', m_fab2: 'mFab2',
  composition: 'composition', finish: 'finish', gsm: 'gsm',
  lycra_non_lycra: 'lycra', collar: 'collar', collar_style: 'collarStyle',
  placket: 'placket', sleeve: 'sleeve', sleeve_fold: 'sleeveFold',
  bottom_fold: 'bottomFold', neck: 'neck', neck_details: 'neckDetails',
  neck_detail: 'neckDetails', fit: 'fit', length: 'length',
  body_style: 'pattern', pocket_type: 'pocketType', no_of_pocket: 'noOfPocket',
  print_type: 'printType', print_style: 'printStyle', print_placement: 'printPlacement',
  patches: 'patches', patch_type: 'patchesType', patches_type: 'patchesType',
  embroidery: 'embroidery', embroidery_type: 'embroideryType',
  emb_placement: 'embPlacement', button: 'button', btn_colour: 'btnColour',
  zipper: 'zipper', zip_colour: 'zipColour', wash: 'wash',
  drawcord: 'drawcord', dc_shape: 'dcShape', father_belt: 'fatherBelt',
  htrf_type: 'htrfType', htrf_style: 'htrfStyle', shade: 'shade',
  weight: 'weight', child_belt: 'childBelt', front_open_style: 'frontOpenStyle',
  segment: 'segment', age_group: 'ageGroup', article_fashion_type: 'articleFashionType',
  mvgr_brand_vendor: 'mvgrBrandVendor', f_count: 'fCount',
  f_construction: 'fConstruction', f_ounce: 'fOunce', f_width: 'fWidth',
  fab_div: 'fabDiv', fab_vdr: 'fabVdr',
  extra_pocket: 'extraPocket', imp_atrbt2: 'impAtrbt2',
};

/** GET /api/article-config/fields — all active field configs */
export async function getFieldConfigs(req: Request, res: Response) {
  try {
    const attrs = await prisma.masterAttribute.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
      select: { id: true, group: true, label: true, key: true, displayOrder: true },
    });
    const data = attrs.map(a => ({
      id: a.id,
      section: a.group || 'GENERAL',
      uiLabel: a.label || a.key,
      dbField: SCHEMA_KEY_TO_DB_FIELD[a.key] ?? a.key,
      sapField: SCHEMA_KEY_TO_DB_FIELD[a.key] ?? a.key,
      displayOrder: a.displayOrder,
    }));
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch field configs' });
  }
}

/** GET /api/article-config/segment-ranges?majorCategory=XXX */
export async function getSegmentRanges(req: Request, res: Response) {
  try {
    const mc = ((req.query.majorCategory as string) || '').trim().toUpperCase();
    if (!mc) {
      res.json({ success: true, data: [] });
      return;
    }
    const rows = await prisma.$queryRaw<{ segment_type: string; min: number; max: number }[]>`
      SELECT segment_type, "min", "max"
      FROM maj_cat_segment
      WHERE UPPER(TRIM(major_category)) = ${mc}
      ORDER BY "min"
    `;
    res.json({ success: true, data: rows.map(r => ({ segment_type: r.segment_type, min: Number(r.min), max: Number(r.max) })) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch segment ranges' });
  }
}
