/**
 * flatToRfcMap.ts
 *
 * Single source of truth for `extractionResultFlat` (camelCase DB field) → SAP key.
 *
 * Used by BOTH:
 *   - zmmArtCreationService (article CREATION via ZMM_ART_CREATION_RFC)
 *   - sapModifyService / ApproverController.modifyItem (article MODIFY via
 *     /api/article/patch-bulk)
 *
 * Keeping this in one place guarantees creation and modify send identical SAP
 * key names (e.g. mrp → MRP, rate → PURCH_PRICE, shade → M_SHADE,
 * weight → NET_WEIGHT, segment → PRICE_BAND_CATEGORY).
 *
 * Order matches the RFC IM_DATA structure from the provided curl reference.
 */
export const FLAT_TO_RFC: Array<{ rfc: string; flat: string }> = [
  // Header / identity
  { rfc: 'HSN_CODE', flat: 'hsnTaxCode' },
  { rfc: 'SUB_DIV', flat: 'subDivision' }, // MS-U / MS-L / LS-U etc.
  { rfc: 'MC_CD', flat: 'mcCode' },
  { rfc: 'VENDOR', flat: 'vendorCode' },
  { rfc: 'DSG_NO', flat: 'designNumber' },
  { rfc: 'MRP', flat: 'mrp' },
  { rfc: 'PURCH_PRICE', flat: 'rate' },
  { rfc: 'SEASON', flat: 'season' },
  { rfc: 'ARTICLE_DES1', flat: 'articleDescription' },
  { rfc: 'PRICE_BAND_CATEGORY', flat: 'segment' },

  // Fabric – macro / main MVGR
  { rfc: 'M_IMP_ATBT', flat: 'impAtrbt2' }, // IMPORTANT ATTRIBUTE
  { rfc: 'M_WEAVE_01', flat: 'weave' }, // F_WEAVE_01
  { rfc: 'M_WEAVE_02', flat: 'mFab2' }, // F_WEAVE_02
  { rfc: 'M_YARN', flat: 'yarn1' }, // F_YARN
  { rfc: 'M_FAB_MAIN_MVGR_1', flat: 'mainMvgr' }, // FAB_MAIN_MVGR-1
  { rfc: 'M_FAB_MAIN_MVGR_2', flat: 'fabricMainMvgr' }, // F_FABRIC MAIN MVGR-02
  { rfc: 'M_COMPOSITION', flat: 'composition' },
  { rfc: 'M_FINISH', flat: 'finish' },
  { rfc: 'M_CONSTRUCTION', flat: 'fConstruction' },
  { rfc: 'M_SHADE', flat: 'shade' },
  { rfc: 'M_LYCRA', flat: 'lycra' },
  { rfc: 'M_GSM', flat: 'gsm' },
  { rfc: 'M_COUNT', flat: 'fCount' },
  { rfc: 'M_OUNZ', flat: 'fOunce' },
  { rfc: 'M_WIDTH', flat: 'fWidth' },
  { rfc: 'M_FAB_DIV', flat: 'fabDiv' },
  { rfc: 'M_FAB_VDR', flat: 'fabVdr' },

  // Body
  { rfc: 'M_COLLAR_TYPE', flat: 'collar' },
  { rfc: 'M_COLLAR_STYLE', flat: 'collarStyle' },
  { rfc: 'M_NECK_TYPE', flat: 'neck' },
  { rfc: 'M_NECK_STYLE', flat: 'neckDetails' },
  { rfc: 'M_PLACKET', flat: 'placket' },
  { rfc: 'M_BLT_TYPE', flat: 'fatherBelt' },
  { rfc: 'M_BLT_STYLE', flat: 'childBelt' },
  { rfc: 'M_SLEEVES_MAIN_STYLE', flat: 'sleeve' },
  { rfc: 'M_SLEEVE_FOLD', flat: 'sleeveFold' },
  { rfc: 'M_SET', flat: 'mSet' },
  { rfc: 'M_BTM_FOLD', flat: 'bottomFold' },
  { rfc: 'M_NO_OF_POCKET', flat: 'noOfPocket' },
  { rfc: 'M_POCKET', flat: 'pocketType' },
  { rfc: 'M_EXTRA_POCKET', flat: 'extraPocket' },
  { rfc: 'M_FIT', flat: 'fit' },
  { rfc: 'M_BODY_STYLE', flat: 'pattern' },
  { rfc: 'M_LENGTH', flat: 'length' },

  // VA Accessories
  { rfc: 'M_DC_STYLE', flat: 'drawcord' },
  { rfc: 'M_DC_SHAPE', flat: 'dcShape' },
  { rfc: 'M_BTN_TYPE', flat: 'button' },
  { rfc: 'M_BTN_CLR', flat: 'btnColour' },
  { rfc: 'M_ZIP_TYPE', flat: 'zipper' },
  { rfc: 'M_ZIP_COL', flat: 'zipColour' },
  { rfc: 'M_PATCHE_TYPE', flat: 'patches' },
  { rfc: 'M_PATCH_STYLE', flat: 'patchesType' },
  { rfc: 'M_HTRF_TYPE', flat: 'htrfType' },
  { rfc: 'M_HTRF_STYLE', flat: 'htrfStyle' },

  // VA Processing
  { rfc: 'M_PRINT_TYPE', flat: 'printType' },
  { rfc: 'M_PRINT_PLACEMENT', flat: 'printPlacement' },
  { rfc: 'M_PRINT_STYLE', flat: 'printStyle' },
  { rfc: 'M_EMB_TYPE', flat: 'embroidery' },
  { rfc: 'M_EMBROIDERY_STYLE', flat: 'embroideryType' },
  { rfc: 'M_EMB_PLACEMENT', flat: 'embPlacement' },
  { rfc: 'M_WASH', flat: 'wash' },

  // Business / segment
  { rfc: 'M_AGE_GROUP', flat: 'ageGroup' },
  { rfc: 'M_NO_OF_SIZE', flat: 'mNoOfSize' },
  { rfc: 'M_NO_OF_CLR', flat: 'mNoOfClr' },
  { rfc: 'M_FAB_WEIGHT', flat: 'weight' }, // fabric weight — SAP key M_FAB_WEIGHT
];

/**
 * Derived lookup: DB field (camelCase) → SAP key.
 * e.g. FLAT_TO_SAP_KEY['fit'] === 'M_FIT', FLAT_TO_SAP_KEY['mrp'] === 'MRP'.
 */
export const FLAT_TO_SAP_KEY: Record<string, string> = Object.fromEntries(
  FLAT_TO_RFC.map((m) => [m.flat, m.rfc]),
);
