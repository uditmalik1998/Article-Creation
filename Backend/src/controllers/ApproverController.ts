import { Request, Response } from 'express';
import { ApprovalStatus, SapSyncStatus, Prisma } from '../generated/prisma';
import { getHsnCodeByMcCode, getMcCodeByMajorCategory } from '../utils/mcCodeMapper';
import { parseNumericValue } from '../utils/mrpCalculator';
import { getSegmentFromMaster } from '../services/segmentMasterService';
import { syncApprovedItemsToSap } from '../services/sapSyncService';
import { syncArticlesToSapViaRfc, buildModifyChangesPayload, previewRfcPayloads } from '../services/zmmArtCreationService';
import { patchArticleAttributes } from '../services/sapModifyService';
import { FLAT_TO_RFC, FLAT_TO_SAP_KEY } from '../data/flatToRfcMap';
import { randomUUID } from 'crypto';
import { validateAgainstNationalGrid } from '../services/nationalGridValidation';
import { syncVariantsToSapViaRfc } from '../services/zmmVarArtCreationService';
import { syncGmVariantsToSap, type GmVariantSyncSummary } from '../services/zmmGMVarArtCreationService';
import { buildHandoffArticle, sendHandoffToPoWise } from '../services/poWiseHandoffService';
import { storageService, type WatermarkLabel } from '../services/storageService';
import { ARTICLE_DESCRIPTION_SOURCE_FIELDS, buildArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { prismaClient as prisma } from '../utils/prisma';
import { syncGenericToVariants, addColorVariants, getSizesForMajCat, isSizeAllowed, rebuildVariantsForMajCat } from '../services/variantCreationService';
import { hasVendorCode, isValidVendorCode, normalizeVendorCode } from '../utils/vendorCode';
import { getSetMcIndex, setProblems, SET_PARTS_USE_SET_MC, normalMcForCategory } from '../services/setMcMasterService';
import { linkComboGroupForRow, recomputeComboParent, syncSetsFromRaw, COMBO_PARENT_DERIVED_FIELDS, groupSetParts } from '../services/comboLinkService';
import { linkSetPart, retryPendingSetLinks } from '../services/setLinkService';

// Fields a client is allowed to update / modify on an article. Shared by
// updateItem (PUT) and modifyItem (SAP patch-bulk). Anything not in this list
// (ids, status, timestamps, SAP metadata) is never client-writable.
const ITEM_UPDATE_ALLOWED_FIELDS = [
    'articleNumber', 'division', 'subDivision', 'majorCategory', 'vendorName', 'designNumber',
    'pptNumber', 'rate', 'size', 'yarn1', 'yarn2', 'fabricMainMvgr', 'weave',
    'composition', 'finish', 'gsm', 'shade', 'weight', 'lycra', 'neck', 'neckDetails',
    // Body fields (full set)
    'collar', 'collarStyle', 'placket', 'sleeve', 'sleeveFold', 'mSet', 'bottomFold',
    'frontOpenStyle', 'noOfPocket', 'pocketType', 'extraPocket',
    'fit', 'pattern', 'length', 'colour', 'fatherBelt', 'childBelt',
    // Fabric detail fields
    'fCount', 'fConstruction', 'fOunce', 'fWidth', 'fabDiv', 'fabVdr',
    // VA Accessories
    'drawcord', 'dcShape', 'button', 'btnColour', 'zipper', 'zipColour',
    'patches', 'patchesType',
    // VA Accessories — new
    'htrfType', 'htrfStyle',
    // VA Processing
    'printType', 'printStyle', 'printPlacement',
    'embroidery', 'embroideryType', 'embPlacement', 'wash',
    // Business
    'ageGroup', 'articleFashionType', 'articleDimension', 'mNoOfSize', 'mNoOfClr',
    'referenceArticleNumber', 'referenceArticleDescription',
    'impAtrbt2',
    // Business / SAP fields
    'macroMvgr', 'mainMvgr', 'mFab2',
    'vendorCode', 'mrp', 'mcCode', 'segment', 'season',
    'hsnTaxCode', 'articleDescription', 'fashionGrid', 'year', 'articleType',
    // Body article cost fields
    'fWidth',
    'autoBgt', 'roughV2', 'vendorFabricRate', 'finalCost',
    'roughRatio', 'roughConsumptionKg', 'roughConsumptionMeter',
    'preciseRatio', 'preciseConsumptionKg', 'preciseConsumptionMeter',
    // CMP Cost PR VAL per process × scenario
    'cuttingBgtPrVal', 'cuttingActPrVal', 'cuttingVendorPrVal', 'cuttingFinalPrVal',
    'stitchingBgtPrVal', 'stitchingActPrVal', 'stitchingVendorPrVal', 'stitchingFinalPrVal',
    'ironingBgtPrVal', 'ironingActPrVal', 'ironingVendorPrVal', 'ironingFinalPrVal',
    'finishingBgtPrVal', 'finishingActPrVal', 'finishingVendorPrVal', 'finishingFinalPrVal',
    'totalBgtPrVal', 'totalActPrVal', 'totalVendorPrVal', 'totalFinalPrVal',
    // B TRIM costing (values belong to the tab in bTrimType)
    'bTrimType', 'bTrimTotalAutoBgt', 'bTrimTotalRoughV2', 'bTrimTotalVdrCost', 'bTrimTotalFinalCost',
    'mBtnAutoBgt', 'mBtnRoughV2', 'mBtnVdrCost', 'mBtnFinalCost',
    'dcAutoBgt', 'dcRoughV2', 'dcVdrCost', 'dcFinalCost',
    'zipAutoBgt', 'zipRoughV2', 'zipVdrCost', 'zipFinalCost',
    'patchAutoBgt', 'patchRoughV2', 'patchVdrCost', 'patchFinalCost',
    'hTrfAutoBgt', 'hTrfRoughV2', 'hTrfVdrCost', 'hTrfFinalCost',
    'elasticAutoBgt', 'elasticRoughV2', 'elasticVdrCost', 'elasticFinalCost',
    'fusingAutoBgt', 'fusingRoughV2', 'fusingVdrCost', 'fusingFinalCost',
    'badgeAutoBgt', 'badgeRoughV2', 'badgeVdrCost', 'badgeFinalCost',
    'rivetAutoBgt', 'rivetRoughV2', 'rivetVdrCost', 'rivetFinalCost',
    'tapeAutoBgt', 'tapeRoughV2', 'tapeVdrCost', 'tapeFinalCost',
    'otherAutoBgt', 'otherRoughV2', 'otherVdrCost', 'otherFinalCost',
    'adjusterAutoBgt', 'adjusterRoughV2', 'adjusterVdrCost', 'adjusterFinalCost',
    'brotchAutoBgt', 'brotchRoughV2', 'brotchVdrCost', 'brotchFinalCost',
    'buckleAutoBgt', 'buckleRoughV2', 'buckleVdrCost', 'buckleFinalCost',
    'eyeletsAutoBgt', 'eyeletsRoughV2', 'eyeletsVdrCost', 'eyeletsFinalCost',
    'hangingDRingAutoBgt', 'hangingDRingRoughV2', 'hangingDRingVdrCost', 'hangingDRingFinalCost',
    'hookAutoBgt', 'hookRoughV2', 'hookVdrCost', 'hookFinalCost',
    'labelAutoBgt', 'labelRoughV2', 'labelVdrCost', 'labelFinalCost',
    'laceAutoBgt', 'laceRoughV2', 'laceVdrCost', 'laceFinalCost',
    'pockettingFabricAutoBgt', 'pockettingFabricRoughV2', 'pockettingFabricVdrCost', 'pockettingFabricFinalCost',
    'pockettingReadymadeAutoBgt', 'pockettingReadymadeRoughV2', 'pockettingReadymadeVdrCost', 'pockettingReadymadeFinalCost',
    'santaAutoBgt', 'santaRoughV2', 'santaVdrCost', 'santaFinalCost',
    'stopperAutoBgt', 'stopperRoughV2', 'stopperVdrCost', 'stopperFinalCost',
    'tagAutoBgt', 'tagRoughV2', 'tagVdrCost', 'tagFinalCost',
    'tasselsAutoBgt', 'tasselsRoughV2', 'tasselsVdrCost', 'tasselsFinalCost',
    'mBtnRate', 'mBtnQty', 'dcRate', 'dcQty', 'zipRate', 'zipQty', 'patchRate', 'patchQty', 'hTrfRate', 'hTrfQty', 'elasticRate', 'elasticQty', 'fusingRate', 'fusingQty', 'badgeRate', 'badgeQty', 'rivetRate', 'rivetQty', 'tapeRate', 'tapeQty', 'otherRate', 'otherQty', 'adjusterRate', 'adjusterQty', 'brotchRate', 'brotchQty', 'buckleRate', 'buckleQty', 'eyeletsRate', 'eyeletsQty', 'hangingDRingRate', 'hangingDRingQty', 'hookRate', 'hookQty', 'labelRate', 'labelQty', 'laceRate', 'laceQty', 'pockettingFabricRate', 'pockettingFabricQty', 'pockettingReadymadeRate', 'pockettingReadymadeQty', 'santaRate', 'santaQty', 'stopperRate', 'stopperQty', 'tagRate', 'tagQty', 'tasselsRate', 'tasselsQty',
    // V. ADD costing per item
    'printAutoBgt', 'printRoughV2', 'printVendorCost', 'printFinalCost',
    'embAutoBgt', 'embRoughV2', 'embVendorCost', 'embFinalCost',
    'washingAutoBgt', 'washingRoughV2', 'washingVendorCost', 'washingFinalCost',
    'vaddTotalAutoBgt', 'vaddTotalRoughV2', 'vaddTotalVendorCost', 'vaddTotalFinalCost',
    // V. ADD extra PRINT / EMB rows (JSON arrays, app only — not in FLAT_TO_RFC so never sent to SAP)
    'vaddPrintJson', 'vaddEmpJson',
    // PKG COST (net prices belong to the tab in pkgCostType)
    'pkgCostType', 'boppNetPrice', 'ctnNetPrice', 'barcodeNetPrice',
    'kimbleNetPrice', 'taftaNetPrice', 'threadNetPrice',
    // Card footer fields (fabric/body article builder)
    'fabricArticleNumber', 'fabricArticleDescription',
    'bodyArticle', 'bodyArticleDescription',
    'attrArticleNums',
    // MC Description (from fabric_article_master mc_des, per major category)
    'mcDescription',
    // Brand vendor MVGR
    'mvgrBrandVendor',
    // Variant-specific fields
    'variantColor', 'variantSize', 'variantWeight',
];

// Fields never written to history_fg_article (auto-derived or explicitly excluded by product)
const HISTORY_EXCLUDED_FIELDS = new Set([
    'fabricArticleDescription', 'bodyArticleDescription',
    'articleDescription', 'mcCode', 'hsnTaxCode', 'mcDescription', 'attrArticleNums',
    'vaddPrintJson', 'vaddEmpJson',
]);

// V. ADD extra-row JSON columns: the client sends a JSON string (or an array);
// store an array, or SQL NULL when empty / invalid.
const VADD_JSON_FIELDS = new Set(['vaddPrintJson', 'vaddEmpJson']);
function parseVaddJson(value: unknown): unknown {
    let v = value;
    if (typeof v === 'string') {
        if (!v.trim()) return Prisma.DbNull;
        try { v = JSON.parse(v); } catch { return Prisma.DbNull; }
    }
    return Array.isArray(v) && v.length > 0 ? v : Prisma.DbNull;
}

// camelCase → snake_case (e.g. fabDiv → fab_div, mrp → mrp)
function camelToSnake(s: string): string {
    return s.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export class ApproverController {
    private static readonly STARTUP_BACKFILL_BATCH_SIZE = parseInt(process.env.STARTUP_BACKFILL_BATCH_SIZE || '250', 10);
    private static readonly STARTUP_BACKFILL_DELAY_MS = parseInt(process.env.STARTUP_BACKFILL_DELAY_MS || '15000', 10);
    private static readonly STARTUP_BACKFILLS_ENABLED = String(process.env.STARTUP_BACKFILLS_ENABLED ?? 'true').toLowerCase() !== 'false';
    private static readonly STARTUP_BACKFILLS_IN_DEV = String(process.env.STARTUP_BACKFILLS_IN_DEV ?? 'false').toLowerCase() === 'true';
    private static startupBackfillRunning = false;
    // Short-lived cache for getItems responses (8s TTL). Eliminates redundant DB hits
    // when multiple users load the same page simultaneously or filters haven't changed.
    private static readonly ITEMS_CACHE_TTL_MS = 8_000;
    private static readonly ITEMS_CACHE_MAX = 100;
    private static itemsCache = new Map<string, { data: any; expiresAt: number }>();
    // Count cache (60s TTL). COUNT(*) is a full-table scan — cache it so only the
    // very first request per filter combination pays the cost.
    private static readonly COUNT_CACHE_TTL_MS = 60_000;
    private static readonly COUNT_CACHE_MAX = 200;
    private static countCache = new Map<string, { value: number; expiresAt: number }>();

    private static extractNumericWeight(value: unknown): string | null {
        if (value === null || value === undefined) return null;
        const text = String(value).trim();
        if (!text) return null;
        const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : null;
    }

    private static readonly SEGMENT_RANGE_ERROR = 'MRP is outside the allowed segment ranges for this category.';

    private static normalizeText(value?: string | null): string {
        return String(value || '').trim().toUpperCase();
    }

    private static getDivisionVariants(value?: string | null): string[] {
        if (!value) return [];

        const tokens = String(value)
            .split(/[;,|]+/)
            .map((t) => ApproverController.normalizeText(t))
            .filter(Boolean);

        const variants: string[] = [];
        for (const token of tokens) {
            if (token === 'MEN' || token === 'MENS') {
                variants.push('MEN', 'MENS');
            } else if (token === 'LADIES' || token === 'WOMEN' || token === 'WOMAN') {
                variants.push('LADIES', 'WOMEN');
            } else if (token === 'KID' || token === 'KIDS') {
                variants.push('KID', 'KIDS');
            } else {
                variants.push(token);
            }
        }

        return Array.from(new Set(variants));
    }

    private static getSubDivisionVariants(value?: string | null): string[] {
        if (!value) return [];

        const tokens = String(value)
            .split(/[;,|]+/)
            .map((item) => ApproverController.normalizeText(item))
            .filter(Boolean);

        return Array.from(new Set(tokens));
    }

    private static getCurrentYearString(): string {
        return String(new Date().getFullYear());
    }

    private static getCurrentSeasonConfig(now: Date = new Date()): { seasonName: string; seasonCode: string; yearFull: string; yearShort: string } {
        const month = now.getMonth() + 1; // 1-12
        const yearFull = String(now.getFullYear());
        const yearShort = yearFull.slice(-2);

        if (month >= 1 && month <= 3) {
            return {
                seasonName: 'SPRING-SUMMER',
                seasonCode: `SP${yearShort}`,
                yearFull,
                yearShort
            };
        }

        if (month >= 4 && month <= 6) {
            return {
                seasonName: 'SUMMER',
                seasonCode: `S${yearShort}`,
                yearFull,
                yearShort
            };
        }

        if (month >= 7 && month <= 9) {
            return {
                seasonName: 'AUTUMN',
                seasonCode: `A${yearShort}`,
                yearFull,
                yearShort
            };
        }

        return {
            seasonName: 'WINTER',
            seasonCode: `W${yearShort}`,
            yearFull,
            yearShort
        };
    }

    private static applyApproverScope(where: any, user?: Express.Request['user']) {
        const role = String(user?.role || '');

        const addDivisionScope = (divisionValue?: string | null) => {
            const variants = ApproverController.getDivisionVariants(divisionValue);
            if (variants.length === 0) return;

            // SRM records are cross-divisional presentations — always visible regardless
            // of the approver's assigned division.
            where.AND = where.AND || [];
            where.AND.push({
                OR: [
                    { source: 'SRM' },
                    ...variants.map((variant) => ({
                        division: { equals: variant, mode: 'insensitive' }
                    }))
                ]
            });
        };

        const addSubDivisionScope = (subDivisionValue?: string | null) => {
            const variants = ApproverController.getSubDivisionVariants(subDivisionValue);
            if (variants.length === 0) return;

            // Include articles with matching subDivision OR with null/empty subDivision
            // (articles extracted without category assignment should still be visible).
            // NOTE: SRM records are NOT exempt here — an SRM article with subDivision='LN&L'
            // must NOT appear for a user scoped to LK&L,LW. Only SRM articles with
            // null/empty subDivision pass through (via the null/'' conditions below).
            where.AND = where.AND || [];
            where.AND.push({
                OR: [
                    ...variants.map((variant) => ({
                        subDivision: { equals: variant, mode: 'insensitive' }
                    })),
                    { subDivision: null },
                    { subDivision: '' }
                ]
            });
        };

        if (role === 'APPROVER' || role === 'SUB_DIVISION_HEAD' || role === 'CREATOR') {
            addDivisionScope(user?.division);
            addSubDivisionScope(user?.subDivision);
            return;
        }

        if (role === 'CATEGORY_HEAD') {
            addDivisionScope(user?.division);
            return;
        }
    }

    private static async backfillMissingMcCodes(baseWhere: any): Promise<number> {
        const missingRows = await prisma.extractionResultFlat.findMany({
            where: {
                ...baseWhere,
                mcCode: null,
                majorCategory: { not: null }
            },
            select: {
                id: true,
                majorCategory: true
            },
            take: ApproverController.STARTUP_BACKFILL_BATCH_SIZE
        });

        if (missingRows.length === 0) return 0;

        const idsByCode = new Map<string, string[]>();

        for (const row of missingRows) {
            const code = getMcCodeByMajorCategory(row.majorCategory);
            if (!code) continue;

            const ids = idsByCode.get(code) || [];
            ids.push(row.id);
            idsByCode.set(code, ids);
        }

        if (idsByCode.size === 0) return 0;

        const updates = Array.from(idsByCode.entries()).map(([mcCode, ids]) =>
            prisma.extractionResultFlat.updateMany({
                where: { id: { in: ids } },
                data: {
                    mcCode,
                    hsnTaxCode: getHsnCodeByMcCode(mcCode)
                }
            })
        );

        const results = await Promise.all(updates);
        return results.reduce((sum, r) => sum + r.count, 0);
    }

    private static async backfillMissingHsnCodes(baseWhere: any): Promise<number> {
        const rows = await prisma.extractionResultFlat.findMany({
            where: {
                ...baseWhere,
                mcCode: { not: null },
                hsnTaxCode: null
            },
            select: {
                id: true,
                mcCode: true
            },
            take: ApproverController.STARTUP_BACKFILL_BATCH_SIZE
        });

        if (rows.length === 0) return 0;

        const idsByHsn = new Map<string, string[]>();

        for (const row of rows) {
            const mappedHsn = getHsnCodeByMcCode(row.mcCode);
            if (!mappedHsn) continue;

            const ids = idsByHsn.get(mappedHsn) || [];
            ids.push(row.id);
            idsByHsn.set(mappedHsn, ids);
        }

        if (idsByHsn.size === 0) return 0;

        const updates = Array.from(idsByHsn.entries()).map(([hsnTaxCode, ids]) =>
            prisma.extractionResultFlat.updateMany({
                where: { id: { in: ids } },
                data: { hsnTaxCode }
            })
        );

        const results = await Promise.all(updates);
        return results.reduce((sum, r) => sum + r.count, 0);
    }

    private static async backfillMissingSegments(baseWhere: any): Promise<number> {
        const rows = await prisma.extractionResultFlat.findMany({
            where: {
                ...baseWhere,
                segment: null,
                majorCategory: { not: null },
                mrp: { not: null }
            },
            select: {
                id: true,
                majorCategory: true,
                mrp: true
            },
            take: ApproverController.STARTUP_BACKFILL_BATCH_SIZE
        });

        if (rows.length === 0) return 0;

        const idsBySegment = new Map<string, string[]>();

        for (const row of rows) {
            const segment = await getSegmentFromMaster(row.majorCategory, row.mrp);
            if (!segment) continue;

            const ids = idsBySegment.get(segment) || [];
            ids.push(row.id);
            idsBySegment.set(segment, ids);
        }

        if (idsBySegment.size === 0) return 0;

        const updates = Array.from(idsBySegment.entries()).map(([segment, ids]) =>
            prisma.extractionResultFlat.updateMany({
                where: { id: { in: ids } },
                data: { segment }
            })
        );

        const results = await Promise.all(updates);
        return results.reduce((sum, r) => sum + r.count, 0);
    }

    private static async backfillMissingYears(baseWhere: any): Promise<number> {
        const currentYear = ApproverController.getCurrentYearString();
        const result = await prisma.extractionResultFlat.updateMany({
            where: {
                ...baseWhere,
                OR: [
                    { year: null },
                    { year: '' }
                ]
            },
            data: {
                year: currentYear
            }
        });

        return result.count;
    }

    private static async backfillMissingSeasonCodes(baseWhere: any): Promise<number> {
        const { seasonCode } = ApproverController.getCurrentSeasonConfig();
        const result = await prisma.extractionResultFlat.updateMany({
            where: {
                ...baseWhere,
                OR: [
                    { season: null },
                    { season: '' }
                ]
            },
            data: {
                season: seasonCode
            }
        });

        return result.count;
    }

    private static async refreshArticleDescriptions(baseWhere: any): Promise<number> {
        const BATCH = 500;
        const DESC_FIELDS = {
            id: true,
            articleDescription: true,
            fabDiv: true, yarn1: true, fabricMainMvgr: true, weave: true, mFab2: true,
            lycra: true, neck: true, collar: true, sleeve: true, sleeveFold: true, mSet: true,
            pocketType: true, childBelt: true, length: true,
            fit: true, pattern: true, printType: true, embroideryType: true,
            embroidery: true, wash: true,
        } as const;

        let total = 0;
        let cursor: string | undefined;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const rows = await prisma.extractionResultFlat.findMany({
                where: { ...baseWhere },
                select: DESC_FIELDS,
                orderBy: { id: 'asc' },
                take: BATCH,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            });

            if (rows.length === 0) break;
            cursor = rows[rows.length - 1].id;

            const idsByDescription = new Map<string, string[]>();
            const idsToNull: string[] = [];

            for (const row of rows) {
                const computedDescription = buildArticleDescription(row as any, 40, {
                    excludeFields: await getExcludedDescriptionFields((row as any).majorCategory) as any,
                });
                const currentDescription = row.articleDescription ? String(row.articleDescription).trim() : null;

                if ((computedDescription || null) === (currentDescription || null)) continue;

                if (!computedDescription) {
                    idsToNull.push(row.id);
                    continue;
                }

                const ids = idsByDescription.get(computedDescription) || [];
                ids.push(row.id);
                idsByDescription.set(computedDescription, ids);
            }

            const updates = Array.from(idsByDescription.entries()).map(([articleDescription, ids]) =>
                prisma.extractionResultFlat.updateMany({ where: { id: { in: ids } }, data: { articleDescription } })
            );

            if (idsToNull.length > 0) {
                updates.push(
                    prisma.extractionResultFlat.updateMany({ where: { id: { in: idsToNull } }, data: { articleDescription: null } })
                );
            }

            for (const update of updates) {
                const result = await update;
                total += result.count;
            }

            if (rows.length < BATCH) break; // last page
        }

        return total;
    }

    // Admin endpoint: backfill article descriptions for a date range.
    static async backfillDescriptions(req: Request, res: Response) {
        try {
            // Default: April 10 2026 → now
            const fromDate = req.query.fromDate
                ? new Date(req.query.fromDate as string)
                : new Date('2026-04-10T00:00:00.000Z');
            const toDate = req.query.toDate
                ? new Date(req.query.toDate as string)
                : new Date();

            if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
                return res.status(400).json({ error: 'Invalid fromDate or toDate' });
            }

            console.log(`[Backfill] Article descriptions from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

            const where = {
                createdAt: {
                    gte: fromDate,
                    lte: toDate,
                }
            };

            const updated = await ApproverController.refreshArticleDescriptions(where);
            return res.json({ success: true, updated, fromDate, toDate });
        } catch (err: any) {
            console.error('[Backfill] Error:', err);
            return res.status(500).json({ error: err?.message || 'Backfill failed' });
        }
    }

    // Run once at server startup to backfill missing computed fields across all records.
    static runStartupBackfills(): void {
        if (!ApproverController.STARTUP_BACKFILLS_ENABLED) {
            console.log('[Backfill] Startup backfills disabled by STARTUP_BACKFILLS_ENABLED=false');
            return;
        }

        if (process.env.NODE_ENV === 'development' && !ApproverController.STARTUP_BACKFILLS_IN_DEV) {
            console.log('[Backfill] Skipping startup backfills in development. Set STARTUP_BACKFILLS_IN_DEV=true to enable.');
            return;
        }

        if (ApproverController.startupBackfillRunning) {
            return;
        }

        ApproverController.startupBackfillRunning = true;

        const run = async () => {
            // Small delay between each step so normal user requests can acquire a
            // DB connection without competing with the backfill the entire time.
            const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2_000));
            try {
                await ApproverController.backfillMissingMcCodes({}); await pause();
                await ApproverController.backfillMissingHsnCodes({}); await pause();
                await ApproverController.backfillMissingSegments({}); await pause();
                await ApproverController.backfillMissingYears({}); await pause();
                await ApproverController.backfillMissingSeasonCodes({}); await pause();
                // Article description backfill disabled — new formula applied to new articles only
                // await ApproverController.refreshArticleDescriptions({}); await pause();
                console.log('✅ Startup backfills completed');
            } catch (err: any) {
                console.warn('⚠️ Startup backfills failed (non-critical):', err?.message);
            } finally {
                ApproverController.startupBackfillRunning = false;
            }
        };
        // Delay heavier startup backfills so the first page load is not competing for DB sessions.
        setTimeout(() => { void run(); }, ApproverController.STARTUP_BACKFILL_DELAY_MS);
    }

    // Get items for approver dashboard
    // Filters: approvalStatus (default: PENDING), division, date range, search
    //
    // "Old article" classification (old-path folder markers + 10-digit numeric SAP ids,
    // PENDING-gated) is now persisted in the `is_old_article` column and maintained by the
    // DB trigger trg_set_is_old_article. The old runtime ILIKE+regex scan and the cached
    // ID-set helpers (getOldArticleIds / getNumericOldArticleIds) have been removed — the
    // queries below just filter on `isOldArticle`.

    private static isCardGroupBy(value: unknown): value is 'vendor' | 'category' {
        return value === 'vendor' || value === 'category';
    }

    /**
     * One page of a card list grouped by vendor code or major category (the UI's
     * "Group by"). Groups are ordered by their NEWEST article — so the vendor /
     * category with today's uploads comes first — and each group is newest-first.
     * Prisma's orderBy can't sort rows by a per-group max, so: aggregate the groups,
     * order them here, then fetch only the group slices that fall on this page.
     * A group is contiguous across pages, so the UI never splits it mid-page.
     */
    private static async findGroupedPage(model: any, args: {
        where: any;
        select: any;
        skip: number;
        take: number;
        groupBy: 'vendor' | 'category';
        dateField: 'createdAt' | 'approvedAt';
    }): Promise<{ rows: any[]; total: number }> {
        const { where, select, skip, take, groupBy, dateField } = args;
        const field = groupBy === 'vendor' ? 'vendorCode' : 'majorCategory';

        const groups: any[] = await model.groupBy({
            by: [field],
            where,
            _max: { [dateField]: true },
            _count: { _all: true },
        });
        // Newest group first; groups with no date at all go last, ties by key.
        const latest = (g: any) => (g._max?.[dateField] as Date | null)?.getTime() ?? -Infinity;
        groups.sort((a, b) => (latest(b) - latest(a)) || String(a[field] ?? '').localeCompare(String(b[field] ?? '')));

        const total = groups.reduce((sum, g) => sum + g._count._all, 0);

        // Which part of which group lands in [skip, skip + take).
        const slices: { key: string | null; skip: number; take: number }[] = [];
        let cursor = 0;
        for (const g of groups) {
            const start = cursor;
            const end = cursor + g._count._all;
            cursor = end;
            if (end <= skip) continue;
            if (start >= skip + take) break;
            const localSkip = Math.max(0, skip - start);
            slices.push({ key: g[field] ?? null, skip: localSkip, take: Math.min(end, skip + take) - (start + localSkip) });
        }

        const rowOrder = dateField === 'approvedAt'
            ? [{ approvedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'asc' }];
        const pages = await Promise.all(slices.map((s) => model.findMany({
            // AND keeps any existing vendorCode / majorCategory filter in `where` intact.
            where: { AND: [where, { [field]: s.key }] },
            orderBy: rowOrder,
            skip: s.skip,
            take: s.take,
            select,
        })));
        return { rows: pages.flat(), total };
    }

    static async getItems(req: Request, res: Response) {
        try {
            const { status, division, subDivision, majorCategory, startDate, endDate, search, page = 1, limit = 50, pathType, source, presentationsType, groupBy } = req.query;

            // SRM sets processed without set support arrive unlinked — link them
            // before listing so a set shows as one row (throttled, never blocks the list).
            try {
                if (await syncSetsFromRaw() > 0) {
                    ApproverController.itemsCache.clear();
                    ApproverController.countCache.clear();
                }
            } catch (setErr: any) {
                console.error('[Combo] set sync failed:', setErr?.message);
            }

            // ── Response cache (8 s TTL) ───────────────────────────────────────────
            // Key includes all query params + user scope so different users/filters
            // never share a cached response.
            const role = String(req.user?.role || '');
            // ADMIN, PO_COMMITTEE and PD are unscoped — they see/act across all divisions.
            const isUnscoped = role === 'ADMIN' || role === 'PO_COMMITTEE' || role === 'PD';
            const cacheKey = JSON.stringify({
                role,
                userId: !isUnscoped ? req.user?.id : undefined,
                userDiv: !isUnscoped ? req.user?.division : undefined,
                userSubDiv: !isUnscoped ? req.user?.subDivision : undefined,
                status, division, subDivision, majorCategory, startDate, endDate, search, page, limit, pathType, source, presentationsType, groupBy,
                sapSyncStatus: req.query.sapSyncStatus,
            });
            const cached = ApproverController.itemsCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                return res.json(cached.data);
            }
            // Evict oldest entries when cache is full (hard cap prevents unbounded growth)
            if (ApproverController.itemsCache.size >= ApproverController.ITEMS_CACHE_MAX) {
                const firstKey = ApproverController.itemsCache.keys().next().value;
                if (firstKey !== undefined) ApproverController.itemsCache.delete(firstKey);
            }

            const where: any = {};

            // SRM records are cross-divisional presentations — bypass scope so any authenticated
            // user can see them regardless of their assigned division.
            const bypassScope = source === 'SRM';

            // RBAC: Enforce scope by role
            if (!bypassScope) {
                if (isUnscoped) {
                    // ADMIN / PO_COMMITTEE can filter freely — use case-insensitive variant
                    // matching so "MEN" matches both "MEN" and "MENS" stored values.
                    if (division && division !== 'ALL') {
                        const divVariants = ApproverController.getDivisionVariants(division as string);
                        if (divVariants.length > 0) {
                            where.AND = where.AND || [];
                            where.AND.push({
                                OR: divVariants.map(v => ({ division: { equals: v, mode: 'insensitive' } }))
                            });
                        }
                    }
                    if (subDivision && subDivision !== 'ALL') where.subDivision = { equals: subDivision as string, mode: 'insensitive' };
                } else {
                    // Apply profile-based scope first (division + subDivision from user record)
                    ApproverController.applyApproverScope(where, req.user);

                    // Then narrow by the dropdown filters the user explicitly selected.
                    // These AND on top of the scope — they can only narrow, never expand.
                    if (division && division !== 'ALL') {
                        const divVariants = ApproverController.getDivisionVariants(division as string);
                        if (divVariants.length > 0) {
                            where.AND = where.AND || [];
                            where.AND.push({
                                OR: divVariants.map(v => ({ division: { equals: v, mode: 'insensitive' } }))
                            });
                        }
                    }
                    if (subDivision && subDivision !== 'ALL') {
                        where.AND = where.AND || [];
                        where.AND.push({ subDivision: { equals: subDivision as string, mode: 'insensitive' } });
                    }
                }
            }

            // Path-type filter — backed by the persistent `is_old_article` column
            // (maintained by the DB trigger trg_set_is_old_article). This replaces the
            // old runtime ILIKE+regex scan and the ~25k-row IN/NOT IN list that was
            // shipped to Postgres on every request — the root cause of Disk IO blowout.
            // The column's value is computed by the SAME formula as the legacy
            // getOldArticleIds, so the old/new/created tab contents are unchanged.
            if (pathType === 'old') {
                where.isOldArticle = true;
            } else if (pathType === 'new') {
                where.approvalStatus = ApprovalStatus.PENDING;
                where.isOldArticle = false;
            } else if (pathType === 'rejected') {
                where.approvalStatus = ApprovalStatus.REJECTED;
            } else if (pathType === 'created') {
                where.approvalStatus = ApprovalStatus.APPROVED;
                where.isOldArticle = false;
            } else if (pathType === 'failed') {
                // Failed Creations: generics whose SAP creation failed. User-specific —
                // a user sees only the ones they approved; ADMIN/PD see all.
                where.isGeneric = true;
                where.isOldArticle = false;
                where.sapSyncStatus = SapSyncStatus.FAILED;
                const role = (req.user as any)?.role;
                if (role !== 'ADMIN' && role !== 'PD') {
                    where.approvedBy = (req.user as any)?.id ? Number((req.user as any).id) : -1;
                }
            }

            // Presentations type filter — isolates FG Article vs Fabric Article tabs
            if (presentationsType) {
                where.presentationsType = String(presentationsType);
            }

            // Combo/set children (Kurti Set, Baba Suit, ...) are never listed as
            // independent rows — they only ever surface nested under their parent.
            where.comboRole = { not: 'CHILD' };

            // Status Filtering (Multi-select support)
            // Supports virtual FAILED status mapped from sapSyncStatus=FAILED.
            // Skip status filter when pathType already forces a specific status.
            if (status && status !== 'ALL' && !pathType) {
                const requestedStatuses = (status as string)
                    .split(',')
                    .map(s => String(s || '').trim().toUpperCase())
                    .filter(Boolean);

                const approvalStatuses = requestedStatuses.filter((s) =>
                    s === ApprovalStatus.PENDING ||
                    s === ApprovalStatus.APPROVED ||
                    s === ApprovalStatus.REJECTED
                ) as ApprovalStatus[];

                const includeFailed = requestedStatuses.includes('FAILED');

                if (approvalStatuses.length > 0 || includeFailed) {
                    const statusPredicates: any[] = [];

                    if (approvalStatuses.length > 0) {
                        statusPredicates.push({ approvalStatus: { in: approvalStatuses } });
                    }

                    if (includeFailed) {
                        statusPredicates.push({ sapSyncStatus: SapSyncStatus.FAILED });
                    }

                    where.AND = where.AND || [];
                    where.AND.push(
                        statusPredicates.length === 1
                            ? statusPredicates[0]
                            : { OR: statusPredicates }
                    );
                }
            }

            // Date Range Filtering
            // Created Articles tab filters by approvedAt (when the article was actually approved);
            // every other tab filters by createdAt (when the article was first extracted).
            if (startDate && endDate) {
                const dateField = pathType === 'created' ? 'approvedAt' : 'createdAt';
                (where as any)[dateField] = {
                    gte: new Date(startDate as string),
                    lte: new Date(endDate as string)
                };
            }

            // Text Search — pushed into AND so it never overrides path/status filters
            if (search) {
                const searchTerm = search as string;
                where.AND = where.AND || [];
                where.AND.push({
                    OR: [
                        { articleNumber: { contains: searchTerm, mode: 'insensitive' } },
                        { designNumber: { contains: searchTerm, mode: 'insensitive' } },
                        { vendorCode: { contains: searchTerm, mode: 'insensitive' } },
                        { vendorName: { contains: searchTerm, mode: 'insensitive' } },
                        { pptNumber: { contains: searchTerm, mode: 'insensitive' } },
                        { referenceArticleNumber: { contains: searchTerm, mode: 'insensitive' } },
                    ],
                });
            }

            // Major category filter
            if (majorCategory) where.majorCategory = majorCategory as string;

            // Source filter — 'SRM', 'WATCHER', 'USER', or omitted for all
            if (source && source !== 'ALL') where.source = source as string;

            // SAP sync-status filter — works alongside pathType (e.g. on the Created
            // tab) so users can find FAILED / still-queued (PENDING) syncs.
            const sapSyncFilter = String(req.query.sapSyncStatus || '').trim().toUpperCase();
            if (['SYNCED', 'PENDING', 'FAILED', 'NOT_SYNCED'].includes(sapSyncFilter)) {
                where.sapSyncStatus = sapSyncFilter as SapSyncStatus;
            }

            // Only show generic articles in the main list (variants are fetched via /items/:id/variants)
            where.isGeneric = true;

            // Exclude orphaned records with empty imageUrl (old import artifacts, source=null)
            where.imageUrl = { not: '' };

            // SRM extraction gate: hide SRM records while Gemini is still running.
            // Show when: (a) not SRM, (b) SRM + COMPLETED, (c) SRM + SRM_IMPORT for >30min (Gemini gave up).
            // This prevents a race condition where an approver edits a field that Gemini later overwrites.
            const srmGateTime = new Date(Date.now() - 30 * 60 * 1000);
            where.AND = where.AND || [];
            where.AND.push({
                OR: [
                    { source: { not: 'SRM' } },
                    { source: null },
                    { source: 'SRM', extractionStatus: { not: 'SRM_IMPORT' } },
                    { source: 'SRM', extractionStatus: 'SRM_IMPORT', createdAt: { lt: srmGateTime } },
                ]
            });

            const skip = (Number(page) - 1) * Number(limit);

            // ── Count: serve from cache instantly; fetch synchronously on cache miss ──
            // On the first request for a given filter, run COUNT and findMany in parallel
            // so the response always shows the real total (not a placeholder).
            // The 60-second cache means subsequent requests pay no extra cost.
            const whereKey = JSON.stringify(where);
            const cachedCount = ApproverController.countCache.get(whereKey);
            let total: number;

            // Created tab is ordered by approvedAt (most-recently-approved first) so a
            // freshly-created SAP article appears at the top — consistent with the
            // Created tab's approvedAt date filter/export/card date. NULLs (older
            // approvals without a timestamp) sort last. Every other tab uses createdAt.
            const orderBy = pathType === 'created'
                ? ({ approvedAt: { sort: 'desc', nulls: 'last' } } as const)
                : ({ createdAt: 'desc' } as const);

            const findManyArgs = {
                where,
                skip,
                take: Number(limit),
                orderBy,
                select: {
                    id: true,
                    imageName: true,
                    imageUrl: true,
                    oldImageUrl: true,
                    backImageUrl: true,
                    imageUncPath: true,
                    articleNumber: true,
                    division: true,
                    subDivision: true,
                    majorCategory: true,
                    vendorName: true,
                    vendorCode: true,
                    designNumber: true,
                    pptNumber: true,
                    referenceArticleNumber: true,
                    referenceArticleDescription: true,
                    approvalStatus: true,
                    approvedAt: true,
                    sapSyncStatus: true,
                    sapSyncMessage: true,
                    sapArticleId: true,
                    createdAt: true,
                    updatedAt: true,
                    userName: true,
                    source: true,
                    rate: true,
                    mrp: true,
                    size: true,
                    colour: true,
                    fabricMainMvgr: true,
                    pattern: true,
                    fit: true,
                    neck: true,
                    neckDetails: true,
                    sleeve: true,
                    sleeveFold: true, mSet: true,
                    length: true,
                    collar: true,
                    collarStyle: true,
                    placket: true,
                    bottomFold: true,
                    frontOpenStyle: true,
                    pocketType: true,
                    noOfPocket: true,
                    extraPocket: true,
                    composition: true,
                    gsm: true,
                    weight: true,
                    finish: true,
                    shade: true,
                    lycra: true,
                    yarn1: true,
                    yarn2: true,
                    weave: true,
                    macroMvgr: true,
                    mainMvgr: true,
                    mFab2: true,
                    fabDiv: true,
                    fCount: true,
                    fConstruction: true,
                    fOunce: true,
                    fWidth: true,
                    wash: true,
                    drawcord: true,
                    dcShape: true,
                    button: true,
                    btnColour: true,
                    zipper: true,
                    zipColour: true,
                    fatherBelt: true,
                    childBelt: true,
                    printType: true,
                    printStyle: true,
                    printPlacement: true,
                    patches: true,
                    patchesType: true,
                    embroidery: true,
                    embroideryType: true,
                    embPlacement: true,
                    htrfType: true,
                    htrfStyle: true,
                    ageGroup: true, mNoOfSize: true, mNoOfClr: true,
                    articleFashionType: true,
                    articleDimension: true,
                    mcCode: true,
                    mcDescription: true,
                    impAtrbt2: true,
                    segment: true,
                    season: true,
                    hsnTaxCode: true,
                    articleDescription: true,
                    fashionGrid: true,
                    year: true,
                    articleType: true,
                    autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                    roughRatio: true, roughConsumptionKg: true, roughConsumptionMeter: true,
                    preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
                    cuttingBgtPrVal: true, cuttingActPrVal: true, cuttingVendorPrVal: true, cuttingFinalPrVal: true,
                    stitchingBgtPrVal: true, stitchingActPrVal: true, stitchingVendorPrVal: true, stitchingFinalPrVal: true,
                    ironingBgtPrVal: true, ironingActPrVal: true, ironingVendorPrVal: true, ironingFinalPrVal: true,
                    finishingBgtPrVal: true, finishingActPrVal: true, finishingVendorPrVal: true, finishingFinalPrVal: true, totalBgtPrVal: true, totalActPrVal: true, totalVendorPrVal: true, totalFinalPrVal: true,
                    bTrimType: true, bTrimTotalAutoBgt: true, bTrimTotalRoughV2: true, bTrimTotalVdrCost: true, bTrimTotalFinalCost: true,
                    mBtnAutoBgt: true, mBtnRoughV2: true, mBtnVdrCost: true, mBtnFinalCost: true,
                    dcAutoBgt: true, dcRoughV2: true, dcVdrCost: true, dcFinalCost: true,
                    zipAutoBgt: true, zipRoughV2: true, zipVdrCost: true, zipFinalCost: true,
                    patchAutoBgt: true, patchRoughV2: true, patchVdrCost: true, patchFinalCost: true,
                    hTrfAutoBgt: true, hTrfRoughV2: true, hTrfVdrCost: true, hTrfFinalCost: true,
                    elasticAutoBgt: true, elasticRoughV2: true, elasticVdrCost: true, elasticFinalCost: true,
                    fusingAutoBgt: true, fusingRoughV2: true, fusingVdrCost: true, fusingFinalCost: true,
                    badgeAutoBgt: true, badgeRoughV2: true, badgeVdrCost: true, badgeFinalCost: true,
                    rivetAutoBgt: true, rivetRoughV2: true, rivetVdrCost: true, rivetFinalCost: true,
                    tapeAutoBgt: true, tapeRoughV2: true, tapeVdrCost: true, tapeFinalCost: true,
                    otherAutoBgt: true, otherRoughV2: true, otherVdrCost: true, otherFinalCost: true,
                    adjusterAutoBgt: true, adjusterRoughV2: true, adjusterVdrCost: true, adjusterFinalCost: true,
                    brotchAutoBgt: true, brotchRoughV2: true, brotchVdrCost: true, brotchFinalCost: true,
                    buckleAutoBgt: true, buckleRoughV2: true, buckleVdrCost: true, buckleFinalCost: true,
                    eyeletsAutoBgt: true, eyeletsRoughV2: true, eyeletsVdrCost: true, eyeletsFinalCost: true,
                    hangingDRingAutoBgt: true, hangingDRingRoughV2: true, hangingDRingVdrCost: true, hangingDRingFinalCost: true,
                    hookAutoBgt: true, hookRoughV2: true, hookVdrCost: true, hookFinalCost: true,
                    labelAutoBgt: true, labelRoughV2: true, labelVdrCost: true, labelFinalCost: true,
                    laceAutoBgt: true, laceRoughV2: true, laceVdrCost: true, laceFinalCost: true,
                    pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true, pockettingFabricVdrCost: true, pockettingFabricFinalCost: true,
                    pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true, pockettingReadymadeVdrCost: true, pockettingReadymadeFinalCost: true,
                    santaAutoBgt: true, santaRoughV2: true, santaVdrCost: true, santaFinalCost: true,
                    stopperAutoBgt: true, stopperRoughV2: true, stopperVdrCost: true, stopperFinalCost: true,
                    tagAutoBgt: true, tagRoughV2: true, tagVdrCost: true, tagFinalCost: true,
                    tasselsAutoBgt: true, tasselsRoughV2: true, tasselsVdrCost: true, tasselsFinalCost: true,
                    mBtnRate: true, mBtnQty: true, dcRate: true, dcQty: true, zipRate: true, zipQty: true, patchRate: true, patchQty: true, hTrfRate: true, hTrfQty: true, elasticRate: true, elasticQty: true, fusingRate: true, fusingQty: true, badgeRate: true, badgeQty: true, rivetRate: true, rivetQty: true, tapeRate: true, tapeQty: true, otherRate: true, otherQty: true, adjusterRate: true, adjusterQty: true, brotchRate: true, brotchQty: true, buckleRate: true, buckleQty: true, eyeletsRate: true, eyeletsQty: true, hangingDRingRate: true, hangingDRingQty: true, hookRate: true, hookQty: true, labelRate: true, labelQty: true, laceRate: true, laceQty: true, pockettingFabricRate: true, pockettingFabricQty: true, pockettingReadymadeRate: true, pockettingReadymadeQty: true, santaRate: true, santaQty: true, stopperRate: true, stopperQty: true, tagRate: true, tagQty: true, tasselsRate: true, tasselsQty: true,
                    printAutoBgt: true, printRoughV2: true, printVendorCost: true, printFinalCost: true,
                    embAutoBgt: true, embRoughV2: true, embVendorCost: true, embFinalCost: true,
                    washingAutoBgt: true, washingRoughV2: true, washingVendorCost: true, washingFinalCost: true,
                    vaddTotalAutoBgt: true, vaddTotalRoughV2: true, vaddTotalVendorCost: true, vaddTotalFinalCost: true,
                    vaddPrintJson: true, vaddEmpJson: true,
                    pkgCostType: true, boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                    kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                    // Article reference fields
                    bodyArticle: true,
                    bodyArticleDescription: true,
                    fabricArticleNumber: true,
                    fabricArticleDescription: true,
                    attrArticleNums: true,
                    // Brand vendor MVGR
                    mvgrBrandVendor: true,
                    isGeneric: true,
                    genericArticleId: true,
                    variantSize: true,
                    variantColor: true,
                    approvedBy: true,
                    approver: {
                        select: { name: true, email: true },
                    },
                    comboRole: true,
                    comboParentId: true,
                    comboChildOrder: true,
                }
            };

            let items: any[];
            if (ApproverController.isCardGroupBy(groupBy)) {
                // Grouped cards: groups ordered by their newest article (see findGroupedPage).
                const page = await ApproverController.findGroupedPage(prisma.extractionResultFlat, {
                    where, select: findManyArgs.select, skip, take: Number(limit), groupBy,
                    dateField: pathType === 'created' ? 'approvedAt' : 'createdAt',
                });
                items = page.rows;
                total = page.total;
            } else if (cachedCount && cachedCount.expiresAt > Date.now()) {
                // Cache hit — total is known; only one DB query needed
                total = cachedCount.value;
                items = await prisma.extractionResultFlat.findMany(findManyArgs);
            } else {
                // Cache miss — run findMany + COUNT in parallel so first load shows real total
                const [fetchedItems, countResult] = await Promise.all([
                    prisma.extractionResultFlat.findMany(findManyArgs),
                    prisma.extractionResultFlat.count({ where }),
                ]);
                items = fetchedItems;
                total = countResult;
                ApproverController.countCache.set(whereKey, {
                    value: total,
                    expiresAt: Date.now() + ApproverController.COUNT_CACHE_TTL_MS,
                });
                // Hard cap — evict oldest entry when full
                if (ApproverController.countCache.size >= ApproverController.COUNT_CACHE_MAX) {
                    const firstKey = ApproverController.countCache.keys().next().value;
                    if (firstKey !== undefined) ApproverController.countCache.delete(firstKey);
                }
            }

            // Last-page detection: if fewer rows returned than limit, we know the exact total.
            if (items.length < Number(limit)) {
                total = skip + items.length;
                ApproverController.countCache.set(whereKey, {
                    value: total,
                    expiresAt: Date.now() + ApproverController.COUNT_CACHE_TTL_MS,
                });
            }

            const responseBody = {
                data: items,
                meta: {
                    total,
                    page: Number(page),
                    div: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            };
            ApproverController.itemsCache.set(cacheKey, {
                data: responseBody,
                expiresAt: Date.now() + ApproverController.ITEMS_CACHE_TTL_MS,
            });
            if (res.headersSent) return; // timeout fired while we were querying
            return res.json(responseBody);
        } catch (error) {
            console.error('Error fetching approver items:', error);
            if (res.headersSent) return; // timeout fired before catch ran
            return res.status(500).json({ error: 'Failed to fetch items' });
        }
    }

    // Builds the shared `where` predicate for export endpoints (exportAll + exportAllWithVariants).
    // Reads the same req.query fields and applies the same RBAC, path-type, status, date, search,
    // majorCategory, isGeneric, imageUrl, and SRM-gate logic as the original exportAll body.
    private static buildExportWhere(req: Request): any {
        const { status, division, subDivision, majorCategory, startDate, endDate, search, pathType } = req.query;

        const where: any = {};

        // RBAC — ADMIN, PO_COMMITTEE and PD are unscoped (all divisions).
        const role = String(req.user?.role || '');
        if (role === 'ADMIN' || role === 'PO_COMMITTEE' || role === 'PD') {
            if (division && division !== 'ALL') {
                const divVariants = ApproverController.getDivisionVariants(division as string);
                if (divVariants.length > 0) {
                    where.AND = where.AND || [];
                    where.AND.push({
                        OR: divVariants.map((v: string) => ({ division: { equals: v, mode: 'insensitive' } }))
                    });
                }
            }
            if (subDivision && subDivision !== 'ALL') where.subDivision = { equals: subDivision as string, mode: 'insensitive' };
        } else {
            // Apply profile-based scope first, then narrow by dropdown filters
            ApproverController.applyApproverScope(where, req.user);
            if (division && division !== 'ALL') {
                const divVariants = ApproverController.getDivisionVariants(division as string);
                if (divVariants.length > 0) {
                    where.AND = where.AND || [];
                    where.AND.push({
                        OR: divVariants.map((v: string) => ({ division: { equals: v, mode: 'insensitive' } }))
                    });
                }
            }
            if (subDivision && subDivision !== 'ALL') {
                where.AND = where.AND || [];
                where.AND.push({ subDivision: { equals: subDivision as string, mode: 'insensitive' } });
            }
        }

        // Path-type filter — backed by the persistent `is_old_article` column
        // (see getItems for rationale). No ILIKE scan, no giant IN/NOT IN list.
        if (pathType === 'old') {
            where.isOldArticle = true;
        } else if (pathType === 'new') {
            where.approvalStatus = ApprovalStatus.PENDING;
            where.isOldArticle = false;
        } else if (pathType === 'created') {
            where.approvalStatus = ApprovalStatus.APPROVED;
            where.isOldArticle = false;
        } else if (pathType === 'failed') {
            where.isGeneric = true;
            where.isOldArticle = false;
            where.sapSyncStatus = SapSyncStatus.FAILED;
            const role = (req.user as any)?.role;
            if (role !== 'ADMIN' && role !== 'PD') {
                where.approvedBy = (req.user as any)?.id ? Number((req.user as any).id) : -1;
            }
        }

        // Status filter
        if (status && status !== 'ALL') {
            const requestedStatuses = (status as string)
                .split(',')
                .map(s => String(s || '').trim().toUpperCase())
                .filter(Boolean);

            const approvalStatuses = requestedStatuses.filter((s) =>
                s === ApprovalStatus.PENDING ||
                s === ApprovalStatus.APPROVED ||
                s === ApprovalStatus.REJECTED
            ) as ApprovalStatus[];

            const includeFailed = requestedStatuses.includes('FAILED');

            if (approvalStatuses.length > 0 || includeFailed) {
                const statusPredicates: any[] = [];
                if (approvalStatuses.length > 0) {
                    statusPredicates.push({ approvalStatus: { in: approvalStatuses } });
                }
                if (includeFailed) {
                    statusPredicates.push({ sapSyncStatus: SapSyncStatus.FAILED });
                }
                where.AND = where.AND || [];
                where.AND.push(
                    statusPredicates.length === 1
                        ? statusPredicates[0]
                        : { OR: statusPredicates }
                );
            }
        }

        // Date range — mirror getItems(): Created tab filters by approvedAt, every other
        // tab by createdAt. The export's date column uses the matching field per tab.
        if (startDate && endDate) {
            const dateField = pathType === 'created' ? 'approvedAt' : 'createdAt';
            (where as any)[dateField] = {
                gte: new Date(startDate as string),
                lte: new Date(endDate as string)
            };
        }

        // ?ids=a,b,c — only the cards selected on the page (Rough / Precise Costing).
        // A set card is its parent; its parts are not cards, so a selected parent
        // brings its parts along.
        const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length > 0) {
            where.AND = where.AND || [];
            where.AND.push({ OR: [{ id: { in: ids } }, { comboRole: 'CHILD', comboParentId: { in: ids } }] });
        }

        // Text search — pushed into AND so it never overrides path/status filters
        if (search) {
            const searchTerm = search as string;
            where.AND = where.AND || [];
            where.AND.push({
                OR: [
                    { articleNumber: { contains: searchTerm, mode: 'insensitive' } },
                    { designNumber: { contains: searchTerm, mode: 'insensitive' } },
                    { vendorCode: { contains: searchTerm, mode: 'insensitive' } },
                    { vendorName: { contains: searchTerm, mode: 'insensitive' } },
                    { pptNumber: { contains: searchTerm, mode: 'insensitive' } },
                    { referenceArticleNumber: { contains: searchTerm, mode: 'insensitive' } },
                ],
            });
        }

        // Major category filter
        if (majorCategory) where.majorCategory = majorCategory as string;

        // Only generic articles (variants are sub-rows, not top-level exports)
        where.isGeneric = true;
        where.imageUrl = { not: '' };

        // Same SRM extraction gate as getItems
        const srmGateTimeExport = new Date(Date.now() - 30 * 60 * 1000);
        where.AND = where.AND || [];
        where.AND.push({
            OR: [
                { source: { not: 'SRM' } },
                { source: null },
                { source: 'SRM', extractionStatus: { not: 'SRM_IMPORT' } },
                { source: 'SRM', extractionStatus: 'SRM_IMPORT', createdAt: { lt: srmGateTimeExport } },
            ]
        });

        return where;
    }

    // Export ALL items matching current filters (no pagination) — used for bulk Excel download
    static async exportAll(req: Request, res: Response) {
        try {
            const where = ApproverController.buildExportWhere(req);
            const { pathType } = req.query;

            console.log(`[ApproverController] exportAll pathType=${pathType ?? 'none'}`);

            // No row cap — select only the ~55 fields the frontend export uses.
            // The narrow select keeps each row small enough that even 50k+ rows stays well
            // under the heap limit (vs. fetching all 100+ columns which caused OOM).
            const items = await prisma.extractionResultFlat.findMany({
                where,
                orderBy: pathType === 'created'
                    ? ({ approvedAt: { sort: 'desc', nulls: 'last' } } as const)
                    : ({ createdAt: 'desc' } as const),
                select: {
                    id: true,
                    articleNumber: true,
                    imageName: true,
                    division: true,
                    subDivision: true,
                    majorCategory: true,
                    approvalStatus: true,
                    vendorName: true,
                    vendorCode: true,
                    designNumber: true,
                    pptNumber: true,
                    rate: true,
                    mrp: true,
                    size: true,
                    pattern: true,
                    fit: true,
                    wash: true,
                    macroMvgr: true,
                    mainMvgr: true,
                    yarn1: true,
                    fabricMainMvgr: true,
                    weave: true,
                    mFab2: true,
                    composition: true,
                    finish: true,
                    gsm: true,
                    weight: true,
                    lycra: true,
                    shade: true,
                    neck: true,
                    neckDetails: true,
                    sleeve: true,
                    length: true,
                    collar: true,
                    placket: true,
                    bottomFold: true,
                    frontOpenStyle: true,
                    pocketType: true,
                    drawcord: true,
                    button: true,
                    zipper: true,
                    zipColour: true,
                    fatherBelt: true,
                    childBelt: true,
                    printType: true,
                    printStyle: true,
                    printPlacement: true,
                    patches: true,
                    patchesType: true,
                    embroidery: true,
                    embroideryType: true,
                    referenceArticleNumber: true,
                    referenceArticleDescription: true,
                    mcCode: true,
                    mcDescription: true,
                    segment: true,
                    season: true,
                    hsnTaxCode: true,
                    articleDescription: true,
                    fashionGrid: true,
                    year: true,
                    articleType: true,
                    userName: true,
                    createdAt: true,
                    updatedAt: true,
                    approvedAt: true,
                    sapSyncStatus: true,
                    // BOM
                    impAtrbt2: true,
                    // FAB extras
                    fCount: true,
                    fConstruction: true,
                    fOunce: true,
                    fWidth: true,
                    fabDiv: true,
                    autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                    roughRatio: true, roughConsumptionKg: true, roughConsumptionMeter: true,
                    preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
                    cuttingBgtPrVal: true, cuttingActPrVal: true, cuttingVendorPrVal: true, cuttingFinalPrVal: true,
                    stitchingBgtPrVal: true, stitchingActPrVal: true, stitchingVendorPrVal: true, stitchingFinalPrVal: true,
                    ironingBgtPrVal: true, ironingActPrVal: true, ironingVendorPrVal: true, ironingFinalPrVal: true,
                    finishingBgtPrVal: true, finishingActPrVal: true, finishingVendorPrVal: true, finishingFinalPrVal: true, totalBgtPrVal: true, totalActPrVal: true, totalVendorPrVal: true, totalFinalPrVal: true,
                    bTrimType: true, bTrimTotalAutoBgt: true, bTrimTotalRoughV2: true, bTrimTotalVdrCost: true, bTrimTotalFinalCost: true,
                    mBtnAutoBgt: true, mBtnRoughV2: true, mBtnVdrCost: true, mBtnFinalCost: true,
                    dcAutoBgt: true, dcRoughV2: true, dcVdrCost: true, dcFinalCost: true,
                    zipAutoBgt: true, zipRoughV2: true, zipVdrCost: true, zipFinalCost: true,
                    patchAutoBgt: true, patchRoughV2: true, patchVdrCost: true, patchFinalCost: true,
                    hTrfAutoBgt: true, hTrfRoughV2: true, hTrfVdrCost: true, hTrfFinalCost: true,
                    elasticAutoBgt: true, elasticRoughV2: true, elasticVdrCost: true, elasticFinalCost: true,
                    fusingAutoBgt: true, fusingRoughV2: true, fusingVdrCost: true, fusingFinalCost: true,
                    badgeAutoBgt: true, badgeRoughV2: true, badgeVdrCost: true, badgeFinalCost: true,
                    rivetAutoBgt: true, rivetRoughV2: true, rivetVdrCost: true, rivetFinalCost: true,
                    tapeAutoBgt: true, tapeRoughV2: true, tapeVdrCost: true, tapeFinalCost: true,
                    otherAutoBgt: true, otherRoughV2: true, otherVdrCost: true, otherFinalCost: true,
                    adjusterAutoBgt: true, adjusterRoughV2: true, adjusterVdrCost: true, adjusterFinalCost: true,
                    brotchAutoBgt: true, brotchRoughV2: true, brotchVdrCost: true, brotchFinalCost: true,
                    buckleAutoBgt: true, buckleRoughV2: true, buckleVdrCost: true, buckleFinalCost: true,
                    eyeletsAutoBgt: true, eyeletsRoughV2: true, eyeletsVdrCost: true, eyeletsFinalCost: true,
                    hangingDRingAutoBgt: true, hangingDRingRoughV2: true, hangingDRingVdrCost: true, hangingDRingFinalCost: true,
                    hookAutoBgt: true, hookRoughV2: true, hookVdrCost: true, hookFinalCost: true,
                    labelAutoBgt: true, labelRoughV2: true, labelVdrCost: true, labelFinalCost: true,
                    laceAutoBgt: true, laceRoughV2: true, laceVdrCost: true, laceFinalCost: true,
                    pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true, pockettingFabricVdrCost: true, pockettingFabricFinalCost: true,
                    pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true, pockettingReadymadeVdrCost: true, pockettingReadymadeFinalCost: true,
                    santaAutoBgt: true, santaRoughV2: true, santaVdrCost: true, santaFinalCost: true,
                    stopperAutoBgt: true, stopperRoughV2: true, stopperVdrCost: true, stopperFinalCost: true,
                    tagAutoBgt: true, tagRoughV2: true, tagVdrCost: true, tagFinalCost: true,
                    tasselsAutoBgt: true, tasselsRoughV2: true, tasselsVdrCost: true, tasselsFinalCost: true,
                    mBtnRate: true, mBtnQty: true, dcRate: true, dcQty: true, zipRate: true, zipQty: true, patchRate: true, patchQty: true, hTrfRate: true, hTrfQty: true, elasticRate: true, elasticQty: true, fusingRate: true, fusingQty: true, badgeRate: true, badgeQty: true, rivetRate: true, rivetQty: true, tapeRate: true, tapeQty: true, otherRate: true, otherQty: true, adjusterRate: true, adjusterQty: true, brotchRate: true, brotchQty: true, buckleRate: true, buckleQty: true, eyeletsRate: true, eyeletsQty: true, hangingDRingRate: true, hangingDRingQty: true, hookRate: true, hookQty: true, labelRate: true, labelQty: true, laceRate: true, laceQty: true, pockettingFabricRate: true, pockettingFabricQty: true, pockettingReadymadeRate: true, pockettingReadymadeQty: true, santaRate: true, santaQty: true, stopperRate: true, stopperQty: true, tagRate: true, tagQty: true, tasselsRate: true, tasselsQty: true,
                    printAutoBgt: true, printRoughV2: true, printVendorCost: true, printFinalCost: true,
                    embAutoBgt: true, embRoughV2: true, embVendorCost: true, embFinalCost: true,
                    washingAutoBgt: true, washingRoughV2: true, washingVendorCost: true, washingFinalCost: true,
                    vaddTotalAutoBgt: true, vaddTotalRoughV2: true, vaddTotalVendorCost: true, vaddTotalFinalCost: true,
                    pkgCostType: true, boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                    kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                    // BODY extras
                    collarStyle: true,
                    sleeveFold: true, mSet: true,
                    noOfPocket: true,
                    extraPocket: true,
                    // VA ACC extras
                    dcShape: true,
                    btnColour: true,
                    htrfType: true,
                    htrfStyle: true,
                    // VA PRCS extras
                    embPlacement: true,
                    // BUSINESS extras
                    ageGroup: true, mNoOfSize: true, mNoOfClr: true,
                    articleFashionType: true,
                    mvgrBrandVendor: true,
                    // Approver identity — used by the Created Articles export
                    approvedBy: true,
                    approver: { select: { name: true, email: true } },
                },
            });

            console.log(`[ApproverController] exportAll returning ${items.length} rows`);

            if (res.headersSent) return; // timeout fired while querying
            return res.json({ data: items, meta: { total: items.length, capped: false } });
        } catch (error) {
            console.error('Error in exportAll:', error);
            if (res.headersSent) return; // timeout fired before catch ran
            return res.status(500).json({ error: 'Failed to export items' });
        }
    }

    // Export ALL items WITH their SAP-created variants interleaved (generic row followed immediately
    // by its variant rows) — used by the frontend to build a single Excel with variant data.
    // Uses the same filter/where logic as exportAll via buildExportWhere.
    static async exportAllWithVariants(req: Request, res: Response) {
        try {
            const where = ApproverController.buildExportWhere(req);
            const { pathType, ids } = req.query;

            // When specific article IDs are provided, scope the export to those only
            if (ids && typeof ids === 'string') {
                const idList = ids.split(',').map((id) => id.trim()).filter(Boolean);
                if (idList.length > 0) where.id = { in: idList };
            }

            // Shared select object — same ~65 fields as exportAll's findMany.
            const sharedSelect = {
                id: true,
                articleNumber: true,
                imageName: true,
                division: true,
                subDivision: true,
                majorCategory: true,
                approvalStatus: true,
                vendorName: true,
                vendorCode: true,
                designNumber: true,
                pptNumber: true,
                rate: true,
                mrp: true,
                size: true,
                pattern: true,
                fit: true,
                wash: true,
                macroMvgr: true,
                mainMvgr: true,
                yarn1: true,
                fabricMainMvgr: true,
                weave: true,
                mFab2: true,
                composition: true,
                finish: true,
                gsm: true,
                weight: true,
                lycra: true,
                shade: true,
                neck: true,
                neckDetails: true,
                sleeve: true,
                length: true,
                collar: true,
                placket: true,
                bottomFold: true,
                frontOpenStyle: true,
                pocketType: true,
                drawcord: true,
                button: true,
                zipper: true,
                zipColour: true,
                fatherBelt: true,
                childBelt: true,
                printType: true,
                printStyle: true,
                printPlacement: true,
                patches: true,
                patchesType: true,
                embroidery: true,
                embroideryType: true,
                referenceArticleNumber: true,
                referenceArticleDescription: true,
                mcCode: true,
                segment: true,
                season: true,
                hsnTaxCode: true,
                articleDescription: true,
                fashionGrid: true,
                year: true,
                articleType: true,
                userName: true,
                createdAt: true,
                updatedAt: true,
                approvedAt: true,
                sapSyncStatus: true,
                // BOM
                impAtrbt2: true,
                // FAB extras
                fCount: true,
                fConstruction: true,
                fOunce: true,
                fWidth: true,
                fabDiv: true,
                // BODY extras
                collarStyle: true,
                sleeveFold: true, mSet: true,
                noOfPocket: true,
                extraPocket: true,
                // VA ACC extras
                dcShape: true,
                btnColour: true,
                htrfType: true,
                htrfStyle: true,
                // VA PRCS extras
                embPlacement: true,
                // BUSINESS extras
                ageGroup: true, mNoOfSize: true, mNoOfClr: true,
                articleFashionType: true,
                mvgrBrandVendor: true,
                // Approver identity
                approvedBy: true,
                approver: { select: { name: true, email: true } },
            };

            // Same generics query as exportAll
            const generics = await prisma.extractionResultFlat.findMany({
                where,
                orderBy: pathType === 'created'
                    ? ({ approvedAt: { sort: 'desc', nulls: 'last' } } as const)
                    : ({ createdAt: 'desc' } as const),
                select: sharedSelect,
            });

            const genericIds = generics.map((g: any) => g.id);
            const genericById = new Map<string, any>(generics.map((g: any) => [g.id, g]));

            // Fetch SAP-created variants (own article number present), chunked to bound the IN clause.
            const variantsByGeneric = new Map<string, any[]>();
            const CHUNK = 1000;
            for (let i = 0; i < genericIds.length; i += CHUNK) {
                const chunk = genericIds.slice(i, i + CHUNK);
                if (chunk.length === 0) continue;
                // Variants live in fg_variants_article_data. It only holds the
                // variant's own fields, so the row inherits the generic's attributes.
                const fgVs = await prisma.fgVariantArticleData.findMany({
                    where: {
                        genericArticleId: { in: chunk },
                        variantArticleNumber: { not: null },
                        NOT: { variantArticleNumber: '' },
                    },
                    orderBy: [{ variantColor: 'asc' }, { variantSize: 'asc' }],
                });
                for (const fv of fgVs) {
                    const key = fv.genericArticleId as string;
                    const g = genericById.get(key);
                    if (!g) continue;
                    if (!variantsByGeneric.has(key)) variantsByGeneric.set(key, []);
                    variantsByGeneric.get(key)!.push({
                        ...g,
                        id: fv.id,
                        genericArticleId: key,
                        articleNumber: fv.variantArticleNumber,
                        sapArticleId: fv.variantArticleNumber,
                        variantSize: fv.variantSize,
                        variantColor: fv.variantColor,
                        division: fv.division ?? g.division,
                        subDivision: fv.subDivision ?? g.subDivision,
                        majorCategory: fv.majorCategory ?? g.majorCategory,
                        vendorName: fv.vendorName ?? g.vendorName,
                        vendorCode: fv.vendorCode ?? g.vendorCode,
                        designNumber: fv.designNumber ?? g.designNumber,
                        rate: fv.rate ?? g.rate,
                        mrp: fv.mrp ?? g.mrp,
                        approvalStatus: fv.approvalStatus,
                        sapSyncStatus: fv.sapSyncStatus,
                        approvedAt: fv.approvedAt ?? g.approvedAt,
                        createdAt: fv.createdAt,
                        updatedAt: fv.updatedAt,
                    });
                }
            }

            // Interleave: each generic row immediately followed by its variant rows.
            const rows: any[] = [];
            for (const g of generics) {
                rows.push({ ...g, _rowType: 'Generic', _parentArticleNumber: '' });
                const vs = variantsByGeneric.get((g as any).id) || [];
                for (const v of vs) rows.push({ ...v, _rowType: 'Variant', _parentArticleNumber: (g as any).articleNumber || '' });
            }

            console.log(`[ApproverController] exportAllWithVariants returning ${rows.length} rows (${generics.length} generics)`);
            if (res.headersSent) return;
            return res.json({ data: rows, meta: { total: rows.length, generics: generics.length } });
        } catch (error) {
            console.error('Error in exportAllWithVariants:', error);
            if (res.headersSent) return;
            return res.status(500).json({ error: 'Failed to export with variants' });
        }
    }

    // Rough Costing Excel export — for FG Created articles.
    // Produces 6 rows per article: 1 summary row + 5 component rows (Fab_art, Body Article, Basic Trim Cost, Value Add Acc Cost, Value Add Prcs Cost).
    // Joins body_article_data (by bodyArticleNumber) and fabric_article_data (by fabricArticleNumber) for cost data.
    static async roughCostingExport(req: Request, res: Response) {
        try {
            const where = ApproverController.buildExportWhere(req);

            const fgArticles = await prisma.extractionResultFlat.findMany({
                where,
                orderBy: { approvedAt: { sort: 'desc', nulls: 'last' } },
                select: {
                    id: true,
                    sapArticleId: true,
                    articleNumber: true,
                    articleDescription: true,
                    division: true,
                    subDivision: true,
                    majorCategory: true,
                    mrp: true,
                    segment: true,
                    vendorCode: true,
                    vendorName: true,
                    fabricArticleNumber: true,
                    fabricArticleDescription: true,
                    bodyArticle: true,
                    bodyArticleDescription: true,
                    autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                    roughRatio: true, roughConsumptionKg: true, roughConsumptionMeter: true,
                    preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
                    cuttingBgtPrVal: true, cuttingActPrVal: true, cuttingVendorPrVal: true, cuttingFinalPrVal: true,
                    stitchingBgtPrVal: true, stitchingActPrVal: true, stitchingVendorPrVal: true, stitchingFinalPrVal: true,
                    ironingBgtPrVal: true, ironingActPrVal: true, ironingVendorPrVal: true, ironingFinalPrVal: true,
                    finishingBgtPrVal: true, finishingActPrVal: true, finishingVendorPrVal: true, finishingFinalPrVal: true, totalBgtPrVal: true, totalActPrVal: true, totalVendorPrVal: true, totalFinalPrVal: true,
                    bTrimType: true, bTrimTotalAutoBgt: true, bTrimTotalRoughV2: true, bTrimTotalVdrCost: true, bTrimTotalFinalCost: true,
                    mBtnAutoBgt: true, mBtnRoughV2: true, mBtnVdrCost: true, mBtnFinalCost: true,
                    dcAutoBgt: true, dcRoughV2: true, dcVdrCost: true, dcFinalCost: true,
                    zipAutoBgt: true, zipRoughV2: true, zipVdrCost: true, zipFinalCost: true,
                    patchAutoBgt: true, patchRoughV2: true, patchVdrCost: true, patchFinalCost: true,
                    hTrfAutoBgt: true, hTrfRoughV2: true, hTrfVdrCost: true, hTrfFinalCost: true,
                    elasticAutoBgt: true, elasticRoughV2: true, elasticVdrCost: true, elasticFinalCost: true,
                    fusingAutoBgt: true, fusingRoughV2: true, fusingVdrCost: true, fusingFinalCost: true,
                    badgeAutoBgt: true, badgeRoughV2: true, badgeVdrCost: true, badgeFinalCost: true,
                    rivetAutoBgt: true, rivetRoughV2: true, rivetVdrCost: true, rivetFinalCost: true,
                    tapeAutoBgt: true, tapeRoughV2: true, tapeVdrCost: true, tapeFinalCost: true,
                    otherAutoBgt: true, otherRoughV2: true, otherVdrCost: true, otherFinalCost: true,
                    adjusterAutoBgt: true, adjusterRoughV2: true, adjusterVdrCost: true, adjusterFinalCost: true,
                    brotchAutoBgt: true, brotchRoughV2: true, brotchVdrCost: true, brotchFinalCost: true,
                    buckleAutoBgt: true, buckleRoughV2: true, buckleVdrCost: true, buckleFinalCost: true,
                    eyeletsAutoBgt: true, eyeletsRoughV2: true, eyeletsVdrCost: true, eyeletsFinalCost: true,
                    hangingDRingAutoBgt: true, hangingDRingRoughV2: true, hangingDRingVdrCost: true, hangingDRingFinalCost: true,
                    hookAutoBgt: true, hookRoughV2: true, hookVdrCost: true, hookFinalCost: true,
                    labelAutoBgt: true, labelRoughV2: true, labelVdrCost: true, labelFinalCost: true,
                    laceAutoBgt: true, laceRoughV2: true, laceVdrCost: true, laceFinalCost: true,
                    pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true, pockettingFabricVdrCost: true, pockettingFabricFinalCost: true,
                    pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true, pockettingReadymadeVdrCost: true, pockettingReadymadeFinalCost: true,
                    santaAutoBgt: true, santaRoughV2: true, santaVdrCost: true, santaFinalCost: true,
                    stopperAutoBgt: true, stopperRoughV2: true, stopperVdrCost: true, stopperFinalCost: true,
                    tagAutoBgt: true, tagRoughV2: true, tagVdrCost: true, tagFinalCost: true,
                    tasselsAutoBgt: true, tasselsRoughV2: true, tasselsVdrCost: true, tasselsFinalCost: true,
                    mBtnRate: true, mBtnQty: true, dcRate: true, dcQty: true, zipRate: true, zipQty: true, patchRate: true, patchQty: true, hTrfRate: true, hTrfQty: true, elasticRate: true, elasticQty: true, fusingRate: true, fusingQty: true, badgeRate: true, badgeQty: true, rivetRate: true, rivetQty: true, tapeRate: true, tapeQty: true, otherRate: true, otherQty: true, adjusterRate: true, adjusterQty: true, brotchRate: true, brotchQty: true, buckleRate: true, buckleQty: true, eyeletsRate: true, eyeletsQty: true, hangingDRingRate: true, hangingDRingQty: true, hookRate: true, hookQty: true, labelRate: true, labelQty: true, laceRate: true, laceQty: true, pockettingFabricRate: true, pockettingFabricQty: true, pockettingReadymadeRate: true, pockettingReadymadeQty: true, santaRate: true, santaQty: true, stopperRate: true, stopperQty: true, tagRate: true, tagQty: true, tasselsRate: true, tasselsQty: true,
                    printAutoBgt: true, printRoughV2: true, printVendorCost: true, printFinalCost: true,
                    embAutoBgt: true, embRoughV2: true, embVendorCost: true, embFinalCost: true,
                    washingAutoBgt: true, washingRoughV2: true, washingVendorCost: true, washingFinalCost: true,
                    vaddTotalAutoBgt: true, vaddTotalRoughV2: true, vaddTotalVendorCost: true, vaddTotalFinalCost: true,
                    pkgCostType: true, boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                    kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                    approvedAt: true,
                    approver: { select: { name: true } },
                },
            });

            // Batch-load body_article_data by body article number
            const bodyNums = [...new Set(fgArticles.map(a => a.bodyArticle).filter(Boolean) as string[])];
            const bodyRows = bodyNums.length > 0
                ? await prisma.bodyArticleData.findMany({
                    where: { bodyArticleNumber: { in: bodyNums } },
                    select: { bodyArticleNumber: true, consumptionKg: true, consumptionMeter: true, majorCategory: true },
                })
                : [];
            const bodyMap = new Map(bodyRows.map(r => [r.bodyArticleNumber!, r]));

            // Basic trim cost always comes from the major-category master
            const trimCostByMajCat = await ApproverController.lookupBasicTrimCosts(
                bodyRows.map(r => r.majorCategory),
            );

            // Batch-load fabric_article_data by fabric article number
            const fabricNums = [...new Set(fgArticles.map(a => a.fabricArticleNumber).filter(Boolean) as string[])];
            const fabricRows = fabricNums.length > 0
                ? await prisma.fabricArticleData.findMany({
                    where: { fabricArticleNumber: { in: fabricNums } },
                    select: { fabricArticleNumber: true, v2FabricRate: true, valueAddCost: true },
                })
                : [];
            const fabricMap = new Map(fabricRows.map(r => [r.fabricArticleNumber!, r]));

            const ExcelJS = (await import('exceljs')).default;
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('Rough Costing');

            // Column widths
            const colWidths = [14, 10, 14, 16, 16, 32, 8, 10, 12, 24, 16, 18, 28, 8, 10, 10, 8, 10, 10, 8, 20];
            colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

            // Row 1: title
            ws.addRow(['Rough Costing Report']);
            ws.getCell('A1').font = { bold: true, size: 13 };

            // Row 2: group headers above Vdr/V2 columns
            const grpRow = ws.addRow([null, null, null, null, null, null, null, null, null, null, null, null, null, 'Vendor', 'Vendor', 'Vendor', 'v2', 'v2', 'v2']);
            [14, 15, 16].forEach(c => {
                const cell = grpRow.getCell(c);
                cell.alignment = { horizontal: 'center' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
            });
            [17, 18, 19].forEach(c => {
                const cell = grpRow.getCell(c);
                cell.font = { bold: true };
                cell.alignment = { horizontal: 'center' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
            });

            // Row 3: column headers
            const headers = [
                'FG Article Date', 'Division', 'Sub Division', 'Major Category',
                'Fg Article No.', 'Fg Article Description', 'MRP', 'Segment',
                'Vendor Code', 'Vendor Name',
                'Comp Description', 'Comp Article Number', 'Comp Article Description',
                'Cons', 'Vdr Rate', 'Cost',
                'Cons', 'V2 Rate', 'Cost',
                'Diff', 'FG Approved By',
            ];
            const hdrRow = ws.addRow(headers);
            hdrRow.eachCell(cell => {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.border = { bottom: { style: 'thin' } };
            });

            const toNum = (v: any) => v == null ? null : Number(v);
            const fmtDate = (d: Date | null | undefined) => d ? new Date(d).toLocaleDateString('en-GB') : '';

            let dataRow = 4; // next row index (1-based) after 3 header rows

            for (const a of fgArticles) {
                const bodyData = a.bodyArticle ? bodyMap.get(a.bodyArticle) : null;
                const fabricData = a.fabricArticleNumber ? fabricMap.get(a.fabricArticleNumber) : null;

                const fgNum = a.sapArticleId || a.articleNumber || '';
                const fabCons = toNum(bodyData?.consumptionKg) ?? toNum(bodyData?.consumptionMeter) ?? 0;
                const vdrRate = toNum(a.vendorFabricRate);
                const v2Rate = toNum(fabricData?.v2FabricRate);
                const basicTrim = bodyData?.majorCategory
                    ? trimCostByMajCat.get(bodyData.majorCategory.trim().toUpperCase()) ?? null
                    : null;
                const cmpCost: number | null = null;
                const fgValAdd = 0;
                const fgProcessCost = 0;

                const summaryRowNum = dataRow;
                const compStart = dataRow + 1;
                const compEnd = dataRow + 5;

                // Common FG columns A–J for all 5 rows
                const fgCols = [
                    fmtDate(a.approvedAt),
                    a.division || '', a.subDivision || '', a.majorCategory || '',
                    fgNum, a.articleDescription || '',
                    toNum(a.mrp), a.segment || '',
                    a.vendorCode || '', a.vendorName || '',
                ];

                // Summary row
                const sumRow = ws.addRow([
                    ...fgCols,
                    null, null, null, null, null,
                    { formula: `SUM(P${compStart}:P${compEnd})*1.1` },
                    null, null,
                    { formula: `SUM(S${compStart}:S${compEnd})` },
                    { formula: `P${summaryRowNum}-S${summaryRowNum}` },
                    a.approver?.name || '',
                ]);
                sumRow.getCell(16).numFmt = '#,##0.00';
                sumRow.getCell(19).numFmt = '#,##0.00';
                sumRow.getCell(20).numFmt = '#,##0.00';
                sumRow.font = { bold: true };
                sumRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFACD' } };
                dataRow++;

                // Fabric Article row
                const fabRow = ws.addRow([
                    ...fgCols,
                    'Fabric Article', a.fabricArticleNumber || '', a.fabricArticleNumber ? (a.fabricArticleDescription || '') : '',
                    fabCons, vdrRate,
                    vdrRate != null ? { formula: `N${dataRow}*O${dataRow}` } : null,
                    fabCons, v2Rate,
                    v2Rate != null ? { formula: `Q${dataRow}*R${dataRow}` } : null,
                    null, null,
                ]);
                [14, 15, 16, 17, 18, 19].forEach(c => { fabRow.getCell(c).numFmt = '#,##0.00'; });
                dataRow++;

                // Body Article row
                const bodyRow = ws.addRow([
                    ...fgCols,
                    'Body Article', a.bodyArticle || '', a.bodyArticle ? (a.bodyArticleDescription || '') : '',
                    null, null, cmpCost ?? 0,
                    null, null, cmpCost ?? 0,
                    null, null,
                ]);
                [14, 16, 17, 19].forEach(c => { bodyRow.getCell(c).numFmt = '#,##0.00'; });
                dataRow++;

                // Basic Trim Cost row
                const trimRow = ws.addRow([
                    ...fgCols,
                    'Basic Trim Cost', null, null,
                    null, null, basicTrim,
                    null, null, basicTrim,
                    null, null,
                ]);
                [16, 19].forEach(c => { trimRow.getCell(c).numFmt = '#,##0.00'; });
                dataRow++;

                // Value Add Acc Cost row (from extraction_results_flat.value_add_cost)
                const valAccRow = ws.addRow([
                    ...fgCols,
                    'Value Add Acc Cost', null, null,
                    null, null, fgValAdd,
                    null, null, fgValAdd,
                    null, null,
                ]);
                [16, 19].forEach(c => { valAccRow.getCell(c).numFmt = '#,##0.00'; });
                dataRow++;

                // Value Add Process Cost row (from extraction_results_flat.value_add_process_cost)
                const valPrcsRow = ws.addRow([
                    ...fgCols,
                    'Value Add Prcs Cost', null, null,
                    null, null, fgProcessCost,
                    null, null, fgProcessCost,
                    null, null,
                ]);
                [16, 19].forEach(c => { valPrcsRow.getCell(c).numFmt = '#,##0.00'; });

                // Light grey separator between articles
                [0, 1, 2, 3, 4, 5].forEach(offset => {
                    ws.getRow(summaryRowNum + offset).getCell(1).border = { left: { style: 'medium', color: { argb: 'FFAAAAAA' } } };
                });

                dataRow++;
            }

            const buf = await wb.xlsx.writeBuffer();
            const fileName = `Rough_Costing_${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            return res.send(Buffer.from(buf));
        } catch (error) {
            console.error('Error in roughCostingExport:', error);
            if (res.headersSent) return;
            return res.status(500).json({ error: 'Failed to generate rough costing report' });
        }
    }

    // Precise Costing export — one block per FG article, laid out like the
    // "OUT FORMAT- RAM SIR" Sheet2: article header, cost summary, then a
    // material table (FAB / B TRIM / PKG. COST / VAL. ADD. / BODY). AUTO-BGT and
    // ROUGH-V2 come from the saved costing cards; VDR PR PC COST and FINAL are
    // left blank for the user. Totals and DIFF (= FINAL − ROUGH-V2) are formulas.
    static async preciseCostingExport(req: Request, res: Response) {
        // Phase 1 — fetch all data before touching the response stream
        let fgArticles: any[];
        try {
            const where = ApproverController.buildExportWhere(req);
            fgArticles = await prisma.extractionResultFlat.findMany({
                where,
                orderBy: { approvedAt: { sort: 'desc', nulls: 'last' } },
                select: {
                    id: true,
                    comboRole: true, comboParentId: true, comboChildOrder: true,
                    sapArticleId: true,
                    articleNumber: true,
                    articleDescription: true,
                    majorCategory: true,
                    mrp: true,
                    vendorName: true,
                    fabricArticleNumber: true,
                    fabricArticleDescription: true,
                    autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                    fWidth: true, preciseConsumptionKg: true, roughConsumptionKg: true,
                    preciseConsumptionMeter: true, roughConsumptionMeter: true,
                    bodyArticle: true,
                    bodyArticleDescription: true,
                    cuttingBgtPrVal: true, cuttingActPrVal: true,
                    stitchingBgtPrVal: true, stitchingActPrVal: true,
                    ironingBgtPrVal: true, ironingActPrVal: true,
                    finishingBgtPrVal: true, finishingActPrVal: true,
                    mBtnAutoBgt: true, mBtnRoughV2: true,
                    dcAutoBgt: true, dcRoughV2: true,
                    zipAutoBgt: true, zipRoughV2: true,
                    patchAutoBgt: true, patchRoughV2: true,
                    hTrfAutoBgt: true, hTrfRoughV2: true,
                    elasticAutoBgt: true, elasticRoughV2: true,
                    fusingAutoBgt: true, fusingRoughV2: true,
                    badgeAutoBgt: true, badgeRoughV2: true,
                    rivetAutoBgt: true, rivetRoughV2: true,
                    tapeAutoBgt: true, tapeRoughV2: true,
                    otherAutoBgt: true, otherRoughV2: true,
                    adjusterAutoBgt: true, adjusterRoughV2: true,
                    brotchAutoBgt: true, brotchRoughV2: true,
                    buckleAutoBgt: true, buckleRoughV2: true,
                    eyeletsAutoBgt: true, eyeletsRoughV2: true,
                    hangingDRingAutoBgt: true, hangingDRingRoughV2: true,
                    hookAutoBgt: true, hookRoughV2: true,
                    labelAutoBgt: true, labelRoughV2: true,
                    laceAutoBgt: true, laceRoughV2: true,
                    pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true,
                    pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true,
                    santaAutoBgt: true, santaRoughV2: true,
                    stopperAutoBgt: true, stopperRoughV2: true,
                    tagAutoBgt: true, tagRoughV2: true,
                    tasselsAutoBgt: true, tasselsRoughV2: true,
                    printAutoBgt: true, printRoughV2: true,
                    embAutoBgt: true, embRoughV2: true,
                    washingAutoBgt: true, washingRoughV2: true,
                    boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                    kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                },
            });
        } catch (err) {
            console.error('[preciseCostingExport] DB error', err);
            return res.status(500).json({ error: 'Failed to generate precise costing report' });
        }
        fgArticles = groupSetParts(fgArticles);
        const parentArticleNo = new Map(fgArticles.filter((a) => a.comboRole === 'PARENT').map((a) => [a.id, a.sapArticleId || a.articleNumber || '']));
        const setLabel = (a: any): string =>
            a.comboRole === 'PARENT' ? 'WHOLE SET'
                : a.comboRole === 'CHILD' ? `PART ${a.comboChildOrder ?? ''} OF SET ${parentArticleNo.get(a.comboParentId) ?? ''}`.replace(/\s+/g, ' ').trim()
                    : '';

        // Phase 2 — stream Excel row-by-row (each row is flushed immediately, no full-workbook buffer)
        try {
            const ExcelJS = (await import('exceljs')).default;

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Precise_Costing_${new Date().toISOString().slice(0, 10)}.xlsx"`);

            const wb: any = new (ExcelJS as any).stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: true });
            const ws: any = wb.addWorksheet('PRECISE COSTING');

            // A..Q — widths must be declared before any rows in streaming mode
            ws.columns = [
                { width: 14 }, { width: 22 }, { width: 16 }, { width: 32 }, { width: 7 }, { width: 8 },
                { width: 8 }, { width: 7 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 11 },
                { width: 15 }, { width: 11 }, { width: 10 }, { width: 8 }, { width: 16 },
            ];

            const DARK_BLUE  = 'FF1F4E79';
            const LIGHT_BLUE = 'FFD6E4F0';
            const PURPLE     = 'FFE8DAEF';
            const AMBER      = 'FFFFF2CC';
            const LT_GREEN   = 'FFE2EFDA';
            const GREY       = 'FFF2F2F2';
            const COLS = 17; // A..Q

            const num = (v: any) => (v == null || v === '' ? null : Number(v));
            const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

            // Writes a row (A=index 0) and returns its 1-based row number.
            const addRow = (data: any[], style?: { fill?: string; bold?: boolean; white?: boolean; from?: number; to?: number }): number => {
                const row = ws.addRow(data);
                if (style) {
                    const from = style.from ?? 1, to = style.to ?? COLS;
                    for (let c = from; c <= to; c++) {
                        const cell = row.getCell(c);
                        if (style.fill) cell.fill = fill(style.fill);
                        if (style.bold || style.white) cell.font = { bold: !!style.bold, color: style.white ? { argb: 'FFFFFFFF' } : undefined };
                    }
                }
                for (let c = 11; c <= 15; c++) row.getCell(c).numFmt = '0.00';
                const n = row.number;
                row.commit();
                return n;
            };
            const blank = () => addRow([]);

            // Material row: A..Q, with K/L values and DIFF (O) = FINAL − ROUGH-V2 once FINAL is filled.
            // rowNo is predicted (addRow returns it) so the DIFF formula can reference its own row.
            let nextRow = 0;
            const matRow = (r: {
                type: string; mc: string; artNo?: any; artDesc?: any; uom?: string; qty?: any;
                dash?: boolean; k?: any; l?: any; m?: any; n?: any; kFormula?: string; lFormula?: string;
            }, style?: { fill?: string; bold?: boolean }) => {
                const rn = nextRow;
                const d = r.dash ? '-' : null;
                const k = r.kFormula ? { formula: r.kFormula } : r.k;
                const l = r.lFormula ? { formula: r.lFormula } : r.l;
                const n = addRow([
                    r.type, r.mc, r.artNo ?? null, r.artDesc ?? null, r.uom ?? null, r.qty ?? null,
                    null, d, d, d, k ?? null, l ?? null, r.m ?? null, r.n ?? null,
                    { formula: `IF(N${rn}="","",N${rn}-L${rn})` }, null, null,
                ], style);
                nextRow = n + 1;
                return n;
            };

            // Keep nextRow in step with every write.
            const track = (n: number) => { nextRow = n + 1; return n; };

            const BTRIM_ROWS: [string, string | null][] = [
                ['BTN', 'mBtn'], ['PATCH', 'patch'], ['ZIP', 'zip'], ['DC', 'dc'], ['H_TRF', 'hTrf'],
                ['OTHER', 'other'], ['ADJUSTER', 'adjuster'], ['BADGE', 'badge'], ['BROTCH', 'brotch'], ['BUCKLE', 'buckle'],
                ['ELASTIC', 'elastic'], ['EYELETS', 'eyelets'], ['FUSING', 'fusing'], ['HANGING D-RING', 'hangingDRing'],
                ['HOOK', 'hook'], ['LABEL', 'label'], ['LACE', 'lace'], ['POCKETTING FABRIC', 'pockettingFabric'],
                ['POCKETTING READYMADE', 'pockettingReadymade'], ['RIVETS', 'rivet'], ['SANTA', 'santa'], ['STOPPER', 'stopper'],
                ['TAG', 'tag'], ['TAPE', 'tape'], ['TASSELS', 'tassels'],
            ];
            const PKG_ROWS: [string, string][] = [
                ['BOPP', 'boppNetPrice'], ['CTN', 'ctnNetPrice'], ['BARCODE', 'barcodeNetPrice'],
                ['KIMBLE', 'kimbleNetPrice'], ['TAFTA', 'taftaNetPrice'], ['THREAD', 'threadNetPrice'],
            ];
            const VADD_ROWS: [string, string][] = [['WASH', 'washing'], ['EMB', 'emb'], ['PRINTING', 'print']];
            const BODY_ROWS: [string, string][] = [
                ['CUTTING', 'cutting'], ['STITCHING', 'stitching'], ['IRONING', 'ironing'], ['FINISHING', 'finishing'],
            ];
            const MAT_HDR = [
                'MATERIAL TYPE', 'MATERIAL_MC', 'ART. NO.', 'ART. DES', 'UOM', 'TTL QTY', 'RATE', 'WST %',
                'FAB WIDTH', 'PR PC CONS.', 'AUTO -BGT', 'ROUGH-V2', 'VDR PR PC COST', 'FINAL', 'DIFF', 'RATIO', 'REMARKS',
            ];

            track(addRow([null, 'Detailed 360 Degree Format'], { bold: true, from: 2, to: 2 }));

            // B TRIM / PKG. COST / VAL. ADD. / BODY rows with no cost value at all
            // (AUTO-BGT, ROUGH-V2, VDR, FINAL all empty) are left out. Decided up
            // front so every row of an article's block (and its height) is known.
            const hasCost = (...v: any[]) => v.some((x) => x != null);
            const materialPlan = (a: any) => {
                const btrimKeep = BTRIM_ROWS
                    .map(([name, key]) => ({ name, k: key ? num(a[`${key}AutoBgt`]) : null, l: key ? num(a[`${key}RoughV2`]) : null }))
                    .filter((r) => hasCost(r.k, r.l));
                const pkgKeep = PKG_ROWS
                    .map(([name, field]) => ({ name, rate: num(a[field]) }))
                    .filter((r) => hasCost(r.rate));
                const vaddKeep = VADD_ROWS
                    .map(([name, key]) => ({ name, k: num(a[`${key}AutoBgt`]), l: num(a[`${key}RoughV2`]) }))
                    .filter((r) => hasCost(r.k, r.l));
                const bodyKeep = BODY_ROWS
                    .map(([name, key]) => ({ name, k: num(a[`${key}BgtPrVal`]), l: num(a[`${key}ActPrVal`]) }))
                    .filter((r) => hasCost(r.k, r.l));
                return { btrimKeep, pkgKeep, vaddKeep, bodyKeep };
            };
            // Rows one article's block takes. Full block: 2 blank, header, values, blank,
            // summary header, summary values (7), blank, COST, table header, TOTAL, blank,
            // FAB (6), then each non-empty section as blank + its rows. A set parent whose
            // parts are in the export is only the first 7 rows: its summary adds up the parts.
            const SUMMARY_OFFSET = 6; // summary value row, counted from the block's first row
            const blockHeight = (a: any, compact: boolean): number => {
                if (compact) return 7;
                const pl = materialPlan(a);
                let h = 13;
                for (const n of [pl.btrimKeep.length, pl.pkgKeep.length, pl.vaddKeep.length]) if (n > 0) h += 1 + n;
                if (pl.bodyKeep.length > 0) h += 2 + pl.bodyKeep.length;
                return h;
            };
            const partsInExport = (parentId: string) =>
                fgArticles.filter((x) => x.comboRole === 'CHILD' && x.comboParentId === parentId);

            for (const a of fgArticles) {
                const parts = a.comboRole === 'PARENT' ? partsInExport(a.id) : [];
                const compact = parts.length > 0;
                const blockStart = nextRow;
                track(blank());
                track(blank());

                // Article header
                const role = setLabel(a);
                track(addRow(['FG-MAJ', 'FG-ARTICLE', 'ART DESC', 'VDR_NM', ...(role ? ['SET'] : [])], { fill: DARK_BLUE, bold: true, white: true, from: 1, to: role ? 5 : 4 }));
                track(addRow([a.majorCategory || '', a.sapArticleId || a.articleNumber || '', a.articleDescription || '', a.vendorName || '', ...(role ? [role] : [])]));
                track(blank());

                track(addRow(['MRP', 'AUTO -V2', 'ROUGH-V2', 'VDR PR PC COST', 'FINAL'], { fill: AMBER, bold: true, from: 1, to: 5 }));
                const sumValRow = nextRow;
                const totRow = sumValRow + 4;

                if (compact) {
                    // Whole set: no material table of its own. AUTO-V2 / ROUGH-V2 / VDR /
                    // FINAL = the sum of its parts' summary rows, which follow this block
                    // (groupSetParts puts them right after it).
                    const partRows: number[] = [];
                    let at = blockStart + blockHeight(a, true);
                    for (const p of parts) {
                        partRows.push(at + SUMMARY_OFFSET);
                        at += blockHeight(p, false);
                    }
                    const sumOf = (col: string) => ({ formula: partRows.map((r) => `${col}${r}`).join('+') });
                    const sv = ws.addRow([num(a.mrp), sumOf('B'), sumOf('C'), sumOf('D'), sumOf('E')]);
                    for (let c = 1; c <= 5; c++) sv.getCell(c).numFmt = '0.00';
                    for (let c = 2; c <= 5; c++) sv.getCell(c).fill = fill(LT_GREEN);
                    track(sv.number);
                    sv.commit();
                    if (sumValRow !== blockStart + SUMMARY_OFFSET) console.warn('[preciseCostingExport] set summary drift', sumValRow, blockStart);
                    continue;
                }

                // Cost summary — values point at the material table's total row,
                // which sits 5 rows below the summary value row.
                const sv = ws.addRow([
                    num(a.mrp),
                    { formula: `K${totRow}` }, { formula: `L${totRow}` }, { formula: `M${totRow}` }, { formula: `N${totRow}` },
                ]);
                for (let c = 1; c <= 5; c++) sv.getCell(c).numFmt = '0.00';
                track(sv.number);
                sv.commit();

                track(blank());
                track(addRow([null, null, null, null, null, null, null, null, null, null, 'COST'], { bold: true, from: 11, to: 11 }));
                track(addRow(MAT_HDR, { fill: DARK_BLUE, bold: true, white: true }));

                const { btrimKeep, pkgKeep, vaddKeep, bodyKeep } = materialPlan(a);
                const hasBody = bodyKeep.length > 0;

                // Total row — rows are predicted: FAB starts 2 rows after it, then
                // each non-empty section follows a blank row.
                const firstMat = totRow + 2;
                let lastNonBody = firstMat; // FAB
                for (const n of [btrimKeep.length, pkgKeep.length, vaddKeep.length]) {
                    if (n > 0) lastNonBody += 1 + n;
                }
                const cmpRow = lastNonBody + 2;
                const sumCol = (c: string) =>
                    `SUM(${c}${firstMat}:${c}${lastNonBody})` + (hasBody ? `+${c}${cmpRow}` : '');
                const tr = ws.addRow([
                    'TOTAL', null, null, null, null, null, null, null, null, null,
                    { formula: sumCol('K') }, { formula: sumCol('L') }, { formula: sumCol('M') }, { formula: sumCol('N') },
                    { formula: `IF(N${totRow}=0,"",N${totRow}-L${totRow})` },
                ]);
                for (let c = 1; c <= COLS; c++) {
                    tr.getCell(c).fill = fill(GREY);
                    tr.getCell(c).font = { bold: true };
                }
                for (let c = 11; c <= 15; c++) tr.getCell(c).numFmt = '0.00';
                if (tr.number !== totRow) console.warn('[preciseCostingExport] total row drift', tr.number, totRow);
                track(tr.number);
                tr.commit();
                track(blank());

                // FAB — RATE = Fab card VENDOR COST, WST % = 4, FAB WIDTH = M_WIDTH as a
                // number (38" → 38), PR PC CONS. = first of precise kg, rough kg,
                // precise meter, rough meter.
                // AUTO-BGT / ROUGH-V2 / VDR = (rate × cons) × (100 + WST%) / 100,
                // with the Fab card's AUTO-BGT / ROUGH-V2 / RATE cell. FINAL left blank.
                {
                    const fr = nextRow;
                    const widthNum = parseInt(String(a.fWidth ?? '').replace(/[^0-9.]/g, ''), 10);
                    const cons = num(a.preciseConsumptionKg) ?? num(a.roughConsumptionKg)
                        ?? num(a.preciseConsumptionMeter) ?? num(a.roughConsumptionMeter);
                    const autoBgt = num(a.autoBgt);
                    const roughV2 = num(a.roughV2);
                    const wst = (rate: string) => ({ formula: `+(${rate}*J${fr})*(100+H${fr})/100` });
                    track(addRow([
                        'FAB', 'FAB_MC', a.fabricArticleNumber || null, a.fabricArticleDescription || null, 'KG', null,
                        num(a.vendorFabricRate), 4, Number.isNaN(widthNum) ? null : widthNum, cons,
                        autoBgt != null ? wst(String(autoBgt)) : null,
                        roughV2 != null ? wst(String(roughV2)) : null,
                        wst(`G${fr}`),
                        null,
                        { formula: `IF(N${fr}="","",N${fr}-L${fr})` }, null, null,
                    ], { fill: LIGHT_BLUE }));
                }
                if (btrimKeep.length > 0) {
                    track(blank());
                    for (const r of btrimKeep) {
                        matRow({ type: 'B TRIM', mc: r.name, artDesc: r.name, uom: 'EA', qty: 1, dash: true, k: r.k, l: r.l });
                    }
                }

                if (pkgKeep.length > 0) {
                    track(blank());
                    for (const r of pkgKeep) {
                        matRow({ type: 'PKG. COST', mc: r.name, artDesc: r.name, uom: 'EA', dash: true, k: r.rate, l: r.rate }, { fill: AMBER });
                    }
                }

                if (vaddKeep.length > 0) {
                    track(blank());
                    for (const r of vaddKeep) {
                        matRow({ type: 'VAL. ADD.', mc: r.name, k: r.k, l: r.l }, { fill: LT_GREEN });
                    }
                }

                // BODY — CMP COST row totals the process rows below it
                if (hasBody) {
                    track(blank());
                    const procFirst = cmpRow + 1;
                    const procLast = cmpRow + bodyKeep.length;
                    const cmpN = matRow({
                        type: 'BODY', mc: 'CMP COST', artNo: a.bodyArticle || null, artDesc: a.bodyArticleDescription || null, uom: 'EA',
                        kFormula: `SUM(K${procFirst}:K${procLast})`, lFormula: `SUM(L${procFirst}:L${procLast})`,
                    }, { fill: PURPLE, bold: true });
                    if (cmpN !== cmpRow) console.warn('[preciseCostingExport] cmp row drift', cmpN, cmpRow);
                    for (const r of bodyKeep) {
                        matRow({ type: 'BODY', mc: r.name, k: r.k, l: r.l }, { fill: PURPLE });
                    }
                }
                // A set parent's summary points at its parts' rows by this height.
                if (nextRow !== blockStart + blockHeight(a, false)) {
                    console.warn('[preciseCostingExport] block height drift', a.id, nextRow - blockStart, blockHeight(a, false));
                }
            }

            await ws.commit();
            await wb.commit();
            return;
        } catch (err) {
            console.error('[preciseCostingExport] stream error', err);
            if (!res.headersSent) return res.status(500).json({ error: 'Failed to generate precise costing report' });
            return res.end();
        }
    }


    // Fetch a single item by id — used by the detail page on direct URL access
    static async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const item = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: {
                    id: true, imageName: true, imageUrl: true, oldImageUrl: true, backImageUrl: true, imageUncPath: true,
                    articleNumber: true, division: true, subDivision: true, majorCategory: true,
                    vendorName: true, vendorCode: true, designNumber: true, pptNumber: true,
                    referenceArticleNumber: true, referenceArticleDescription: true,
                    approvalStatus: true, sapSyncStatus: true, sapSyncMessage: true, sapArticleId: true,
                    createdAt: true, updatedAt: true, userName: true, source: true,
                    rate: true, mrp: true, size: true, colour: true,
                    fabricMainMvgr: true, pattern: true, fit: true, neck: true, neckDetails: true,
                    sleeve: true, sleeveFold: true, mSet: true, length: true, collar: true, collarStyle: true,
                    placket: true, bottomFold: true, frontOpenStyle: true, pocketType: true,
                    noOfPocket: true, extraPocket: true, composition: true, gsm: true, weight: true,
                    finish: true, shade: true, lycra: true, yarn1: true, yarn2: true, weave: true,
                    macroMvgr: true, mainMvgr: true, mFab2: true, fabDiv: true,
                    fCount: true, fConstruction: true, fOunce: true, fWidth: true, wash: true,
                    drawcord: true, dcShape: true, button: true, btnColour: true,
                    zipper: true, zipColour: true, fatherBelt: true, childBelt: true,
                    printType: true, printStyle: true, printPlacement: true,
                    patches: true, patchesType: true, embroidery: true, embroideryType: true,
                    embPlacement: true, htrfType: true, htrfStyle: true,
                    ageGroup: true, mNoOfSize: true, mNoOfClr: true, articleFashionType: true, articleDimension: true,
                    mcCode: true, impAtrbt2: true, segment: true, season: true,
                    hsnTaxCode: true, articleDescription: true, fashionGrid: true,
                    year: true, articleType: true,
                    bodyArticle: true, bodyArticleDescription: true,
                    fabricArticleNumber: true, fabricArticleDescription: true,
                    attrArticleNums: true, mvgrBrandVendor: true,
                    isGeneric: true, genericArticleId: true, variantSize: true, variantColor: true,
                    approvedBy: true, approvedAt: true,
                    autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                    roughRatio: true, roughConsumptionKg: true, roughConsumptionMeter: true,
                    preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
                    cuttingBgtPrVal: true, cuttingActPrVal: true, cuttingVendorPrVal: true, cuttingFinalPrVal: true,
                    stitchingBgtPrVal: true, stitchingActPrVal: true, stitchingVendorPrVal: true, stitchingFinalPrVal: true,
                    ironingBgtPrVal: true, ironingActPrVal: true, ironingVendorPrVal: true, ironingFinalPrVal: true,
                    finishingBgtPrVal: true, finishingActPrVal: true, finishingVendorPrVal: true, finishingFinalPrVal: true, totalBgtPrVal: true, totalActPrVal: true, totalVendorPrVal: true, totalFinalPrVal: true,
                    bTrimType: true, bTrimTotalAutoBgt: true, bTrimTotalRoughV2: true, bTrimTotalVdrCost: true, bTrimTotalFinalCost: true,
                    mBtnAutoBgt: true, mBtnRoughV2: true, mBtnVdrCost: true, mBtnFinalCost: true,
                    dcAutoBgt: true, dcRoughV2: true, dcVdrCost: true, dcFinalCost: true,
                    zipAutoBgt: true, zipRoughV2: true, zipVdrCost: true, zipFinalCost: true,
                    patchAutoBgt: true, patchRoughV2: true, patchVdrCost: true, patchFinalCost: true,
                    hTrfAutoBgt: true, hTrfRoughV2: true, hTrfVdrCost: true, hTrfFinalCost: true,
                    elasticAutoBgt: true, elasticRoughV2: true, elasticVdrCost: true, elasticFinalCost: true,
                    fusingAutoBgt: true, fusingRoughV2: true, fusingVdrCost: true, fusingFinalCost: true,
                    badgeAutoBgt: true, badgeRoughV2: true, badgeVdrCost: true, badgeFinalCost: true,
                    rivetAutoBgt: true, rivetRoughV2: true, rivetVdrCost: true, rivetFinalCost: true,
                    tapeAutoBgt: true, tapeRoughV2: true, tapeVdrCost: true, tapeFinalCost: true,
                    otherAutoBgt: true, otherRoughV2: true, otherVdrCost: true, otherFinalCost: true,
                    adjusterAutoBgt: true, adjusterRoughV2: true, adjusterVdrCost: true, adjusterFinalCost: true,
                    brotchAutoBgt: true, brotchRoughV2: true, brotchVdrCost: true, brotchFinalCost: true,
                    buckleAutoBgt: true, buckleRoughV2: true, buckleVdrCost: true, buckleFinalCost: true,
                    eyeletsAutoBgt: true, eyeletsRoughV2: true, eyeletsVdrCost: true, eyeletsFinalCost: true,
                    hangingDRingAutoBgt: true, hangingDRingRoughV2: true, hangingDRingVdrCost: true, hangingDRingFinalCost: true,
                    hookAutoBgt: true, hookRoughV2: true, hookVdrCost: true, hookFinalCost: true,
                    labelAutoBgt: true, labelRoughV2: true, labelVdrCost: true, labelFinalCost: true,
                    laceAutoBgt: true, laceRoughV2: true, laceVdrCost: true, laceFinalCost: true,
                    pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true, pockettingFabricVdrCost: true, pockettingFabricFinalCost: true,
                    pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true, pockettingReadymadeVdrCost: true, pockettingReadymadeFinalCost: true,
                    santaAutoBgt: true, santaRoughV2: true, santaVdrCost: true, santaFinalCost: true,
                    stopperAutoBgt: true, stopperRoughV2: true, stopperVdrCost: true, stopperFinalCost: true,
                    tagAutoBgt: true, tagRoughV2: true, tagVdrCost: true, tagFinalCost: true,
                    tasselsAutoBgt: true, tasselsRoughV2: true, tasselsVdrCost: true, tasselsFinalCost: true,
                    mBtnRate: true, mBtnQty: true, dcRate: true, dcQty: true, zipRate: true, zipQty: true, patchRate: true, patchQty: true, hTrfRate: true, hTrfQty: true, elasticRate: true, elasticQty: true, fusingRate: true, fusingQty: true, badgeRate: true, badgeQty: true, rivetRate: true, rivetQty: true, tapeRate: true, tapeQty: true, otherRate: true, otherQty: true, adjusterRate: true, adjusterQty: true, brotchRate: true, brotchQty: true, buckleRate: true, buckleQty: true, eyeletsRate: true, eyeletsQty: true, hangingDRingRate: true, hangingDRingQty: true, hookRate: true, hookQty: true, labelRate: true, labelQty: true, laceRate: true, laceQty: true, pockettingFabricRate: true, pockettingFabricQty: true, pockettingReadymadeRate: true, pockettingReadymadeQty: true, santaRate: true, santaQty: true, stopperRate: true, stopperQty: true, tagRate: true, tagQty: true, tasselsRate: true, tasselsQty: true,
                    printAutoBgt: true, printRoughV2: true, printVendorCost: true, printFinalCost: true,
                    embAutoBgt: true, embRoughV2: true, embVendorCost: true, embFinalCost: true,
                    washingAutoBgt: true, washingRoughV2: true, washingVendorCost: true, washingFinalCost: true,
                    vaddTotalAutoBgt: true, vaddTotalRoughV2: true, vaddTotalVendorCost: true, vaddTotalFinalCost: true,
                    vaddPrintJson: true, vaddEmpJson: true,
                    pkgCostType: true, boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                    kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                    mcDescription: true,
                    approver: { select: { name: true, email: true } },
                    comboRole: true, comboParentId: true, comboChildOrder: true,
                },
            });
            if (!item) return res.status(404).json({ error: 'Item not found' });
            return res.json(item);
        } catch (error) {
            console.error('Error fetching item by id:', error);
            return res.status(500).json({ error: 'Failed to fetch item' });
        }
    }

    // Delete a variant (only PENDING variants may be deleted)
    static async deleteItem(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // Check fg_variants_article_data first (variants added via Add Color)
            const fgVariant = await prisma.fgVariantArticleData.findUnique({
                where: { id },
                select: { approvalStatus: true },
            });

            if (fgVariant) {
                if (fgVariant.approvalStatus !== ApprovalStatus.PENDING) {
                    return res.status(400).json({ error: 'Only PENDING variants can be deleted' });
                }
                await prisma.fgVariantArticleData.delete({ where: { id } });
                ApproverController.itemsCache.clear();
                ApproverController.countCache.clear();
                return res.json({ success: true });
            }

            // Fall back to extraction_results_flat (original extraction variants)
            const item = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: { approvalStatus: true },
            });
            if (!item) return res.status(404).json({ error: 'Variant not found' });

            if (item.approvalStatus !== ApprovalStatus.PENDING) {
                return res.status(400).json({ error: 'Only PENDING variants can be deleted' });
            }

            await prisma.extractionResultFlat.delete({ where: { id } });

            ApproverController.itemsCache.clear();
            ApproverController.countCache.clear();

            return res.json({ success: true });
        } catch (error) {
            console.error('Error deleting variant:', error);
            return res.status(500).json({ error: 'Failed to delete variant' });
        }
    }

    // Record per-field change history into history_fg_article (fire-and-forget safe).
    private static async recordFgArticleHistory(
        articleId: string,
        user: any,
        changes: Record<string, any>,
        oldRow: Record<string, any>
    ): Promise<void> {
        const inserts: Array<{ fieldName: string; oldValue: string | null; newValue: string | null }> = [];
        for (const [field, newVal] of Object.entries(changes)) {
            if (HISTORY_EXCLUDED_FIELDS.has(field)) continue;
            const dbCol = camelToSnake(field);
            const oldVal = oldRow[dbCol];
            const oldStr = oldVal == null ? null : String(oldVal);
            const newStr = newVal == null ? null : String(newVal);
            if (oldStr !== newStr) {
                inserts.push({ fieldName: field, oldValue: oldStr, newValue: newStr });
            }
        }
        if (inserts.length === 0) return;
        const userId: number | null = user?.id ?? null;
        const userName: string | null = user?.name ?? null;
        for (const { fieldName, oldValue, newValue } of inserts) {
            await prisma.$executeRaw`
                INSERT INTO history_fg_article (article_id, changed_by_id, changed_by_name, field_name, old_value, new_value)
                VALUES (${articleId}, ${userId}, ${userName}, ${fieldName}, ${oldValue}, ${newValue})
            `;
        }
    }

    // GET /approver/items/:id/history — returns change log for a single FG article
    static async getFgArticleHistory(req: Request, res: Response) {
        const { id } = req.params;
        try {
            const history = await prisma.$queryRaw<any[]>`
                SELECT id, article_id, changed_by_id, changed_by_name,
                       changed_at, field_name, old_value, new_value
                FROM history_fg_article
                WHERE article_id = ${id}
                ORDER BY changed_at DESC
                LIMIT 500
            `;
            return res.json(history);
        } catch (err: any) {
            return res.status(500).json({ error: err?.message ?? 'Failed to fetch history' });
        }
    }

    // Update item details (Edit)
    static async updateItem(req: Request, res: Response) {
        ApproverController.itemsCache.clear();
        ApproverController.countCache.clear();
        try {
            const { id } = req.params;
            const rawData = req.body;

            // Whitelist allowed fields to prevent overwriting metadata
            // and sanitize types (shared with modifyItem via ITEM_UPDATE_ALLOWED_FIELDS)
            const data: any = {};

            for (const field of ITEM_UPDATE_ALLOWED_FIELDS) {
                if (rawData[field] !== undefined) {
                    let value = rawData[field];

                    // Handle numeric/decimal fields (rate, mrp)
                    if (field === 'rate' || field === 'mrp') {
                        if (value === '' || value === null || value === undefined) {
                            value = null;
                        } else {
                            value = parseNumericValue(value);
                        }
                    } else if (field === 'weight') {
                        value = ApproverController.extractNumericWeight(value);
                    } else if (VADD_JSON_FIELDS.has(field)) {
                        value = parseVaddJson(value);
                    } else if (value === '') {
                        // Convert empty strings to null for optional text fields
                        // Actually extractionResultFlat fields are mostly nullable strings, so '' might be okay or null preference.
                        // Let's stick to null for empty strings to be cleaner
                        value = null;
                    }

                    if (field === 'vendorCode') {
                        if (!hasVendorCode(value)) {
                            return res.status(400).json({
                                error: 'Vendor Code is required and must be exactly 6 digits.'
                            });
                        }
                        if (!isValidVendorCode(value)) {
                            return res.status(400).json({
                                error: 'Vendor Code is required and must be exactly 6 digits.'
                            });
                        }
                        value = normalizeVendorCode(value);
                    }

                    data[field] = value;
                }
            }

            // Validate majorCategory — use major_category_details table as source of truth.
            if (data.majorCategory !== undefined && data.majorCategory !== null) {
                const majorCategoryText = String(data.majorCategory).trim();
                if (majorCategoryText) {
                    const mcDetails = await prisma.majorCategoryDetails.findFirst({
                        where: { mcDes: { equals: majorCategoryText, mode: 'insensitive' }, mcStatus: 'ACT' },
                        select: { mcCode: true, hsnCode: true },
                    });
                    if (mcDetails) {
                        data.mcCode = mcDetails.mcCode || null;
                        data.hsnTaxCode = mcDetails.hsnCode || null;
                    } else {
                        return res.status(400).json({
                            error: `Invalid majorCategory '${majorCategoryText}'. Please use values from mc code list (mc des).`
                        });
                    }
                }
            } else if (data.majorCategory !== undefined) {
                // majorCategory explicitly set to null/empty — clear derived fields
                data.mcCode = null;
                data.hsnTaxCode = null;
            } else if (data.mcCode !== undefined) {
                data.hsnTaxCode = getHsnCodeByMcCode(data.mcCode) || null;
            }

            // Snapshot full row for history comparison (before the update)
            const oldRowSnap = await prisma.$queryRawUnsafe<any[]>(
                `SELECT * FROM extraction_results_flat WHERE id = $1`, id
            );
            const oldRow: Record<string, any> = oldRowSnap[0] ?? {};

            // RBAC: Check access for Approvers & Validate Status
            const existingItem = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: {
                    id: true,
                    approvalStatus: true,
                    rate: true,
                    division: true,
                    subDivision: true,
                    majorCategory: true,
                    mrp: true,
                    // Article description fields (47-field sequence)
                    fabDiv: true,
                    yarn1: true,
                    mainMvgr: true,
                    fabricMainMvgr: true,
                    weave: true,
                    mFab2: true,
                    fCount: true,
                    gsm: true,
                    fOunce: true,
                    fConstruction: true,
                    finish: true,
                    fWidth: true,
                    lycra: true,
                    neck: true,
                    neckDetails: true,
                    collar: true,
                    collarStyle: true,
                    sleeve: true,
                    sleeveFold: true, mSet: true,
                    placket: true,
                    childBelt: true,
                    bottomFold: true,
                    pocketType: true,
                    noOfPocket: true,
                    extraPocket: true,
                    length: true,
                    fit: true,
                    pattern: true,
                    drawcord: true,
                    dcShape: true,
                    zipper: true,
                    zipColour: true,
                    button: true,
                    btnColour: true,
                    patchesType: true,
                    patches: true,
                    htrfStyle: true,
                    htrfType: true,
                    printPlacement: true,
                    printStyle: true,
                    printType: true,
                    embroidery: true,
                    embroideryType: true,
                    embPlacement: true,
                    wash: true,
                    ageGroup: true, mNoOfSize: true, mNoOfClr: true,
                    impAtrbt2: true,
                    // Other fields used for logic/display
                    macroMvgr: true,
                    fatherBelt: true,
                    yarn2: true,
                    composition: true,
                    shade: true,
                    weight: true,
                    frontOpenStyle: true,
                    vendorCode: true,
                    season: true,
                    year: true,
                    isGeneric: true,
                    pdStatus: true,
                    comboRole: true,
                    comboParentId: true,
                }
            });

            if (!existingItem) {
                return res.status(404).json({ error: 'Item not found' });
            }

            // Combo/set parent: costs + attributes are derived from its children
            // (recomputeComboParent) — ignore direct edits to them.
            const isComboParent = existingItem.comboRole === 'PARENT';
            if (isComboParent) {
                for (const k of Object.keys(data)) {
                    if (COMBO_PARENT_DERIVED_FIELDS.has(k)) delete data[k];
                }
            }

            // Prevent updating approved items, EXCEPT:
            // - variantWeight: must be settable after approval so SAP retry can proceed
            // - fabricArticleDescription + vendorFabricRate: internal fields pre-saved before
            //   fabric article creation in modify mode; not part of SAP attribute sync
            const APPROVED_ITEM_ALLOWED_FIELDS = new Set(['variantWeight', 'fabricArticleDescription', 'vendorFabricRate', 'fabricArticleNumber']);
            const isAllowedUpdate = Object.keys(data).every((k) => APPROVED_ITEM_ALLOWED_FIELDS.has(k));
            if (existingItem.approvalStatus === 'APPROVED' && !isAllowedUpdate) {
                return res.status(403).json({ error: 'Cannot update an approved item. It is locked for SAP sync.' });
            }

            const role = String(req.user?.role || '');

            if (role === 'APPROVER' || role === 'CATEGORY_HEAD' || role === 'CREATOR' || role === 'SUB_DIVISION_HEAD') {
                const existingDivision = ApproverController.normalizeText(existingItem.division);
                const existingSubDivision = ApproverController.normalizeText(existingItem.subDivision);
                const userDivisionVariants = ApproverController.getDivisionVariants(req.user?.division);
                const userSubDivisionVariants = ApproverController.getSubDivisionVariants(req.user?.subDivision);

                if (userDivisionVariants.length > 0 && !userDivisionVariants.includes(existingDivision)) {
                    return res.status(403).json({ error: 'Access denied: Division mismatch' });
                }
                // Allow update when article has no subDivision yet (null/empty) — same as list query logic
                if ((role === 'APPROVER' || role === 'CREATOR' || role === 'SUB_DIVISION_HEAD') && userSubDivisionVariants.length > 0 && existingSubDivision && !userSubDivisionVariants.includes(existingSubDivision)) {
                    return res.status(403).json({ error: 'Access denied: Sub-Division mismatch' });
                }
            }

            const toComparableNumber = (value: unknown): number | null => {
                const parsed = parseNumericValue(value);
                return parsed === null ? null : Number(parsed.toFixed(2));
            };

            const incomingRate = data.rate !== undefined ? toComparableNumber(data.rate) : null;
            const existingRate = toComparableNumber(existingItem.rate);
            const rateActuallyChanged = data.rate !== undefined && incomingRate !== existingRate;

            // MRP is manually set by the user — no auto-derivation from rate.

            const finalMajorCategory = (data.majorCategory !== undefined ? data.majorCategory : existingItem.majorCategory) as string | null;
            const finalMrp = data.mrp !== undefined ? data.mrp : existingItem.mrp;

            // Major category change on a generic with colour variants: the sizes belong
            // to the old category, so the variants are rebuilt after the update (same
            // colours, new category's sizes). Blocked when a variant is already in SAP,
            // or when the new category has no sizes (the colours would be lost).
            const oldMajCat = String(existingItem.majorCategory ?? '').trim().toUpperCase();
            const newMajCat = String(finalMajorCategory ?? '').trim().toUpperCase();
            let rebuildSizes: string[] | null = null;
            if (existingItem.isGeneric && data.majorCategory !== undefined && newMajCat !== oldMajCat) {
                const variants = await prisma.fgVariantArticleData.findMany({
                    where: { genericArticleId: id },
                    select: { variantArticleNumber: true, sapSyncStatus: true },
                });
                if (variants.length > 0) {
                    const inSap = variants.filter((v) => v.variantArticleNumber || v.sapSyncStatus === 'SYNCED').length;
                    if (inSap > 0) {
                        return res.status(409).json({
                            error: `Can't change Major Category: ${inSap} size variant(s) of this article are already in SAP.`,
                        });
                    }
                    const sizes = newMajCat ? await getSizesForMajCat(newMajCat) : [];
                    if (sizes.length === 0) {
                        return res.status(422).json({
                            error: `Can't change Major Category: no active sizes for '${finalMajorCategory ?? ''}' in the Size Master, so the colour variants can't be re-created.`,
                        });
                    }
                    rebuildSizes = sizes;
                }
            }

            // PR1 size guard: when a variant's size is edited, the new size must be
            // valid for its Major Category (server-side backstop behind the UI dropdown).
            if (!existingItem.isGeneric && (data.variantSize !== undefined || data.size !== undefined)) {
                const newSize = String((data.variantSize ?? data.size) ?? '').trim();
                if (newSize && finalMajorCategory) {
                    let sizeOk: boolean;
                    try {
                        sizeOk = await isSizeAllowed(finalMajorCategory, newSize);
                    } catch (err: any) {
                        return res.status(500).json({ error: err?.message || 'Size validation failed' });
                    }
                    if (!sizeOk) {
                        return res.status(422).json({
                            error: 'INVALID_SIZE_FOR_CATEGORY',
                            detail: `Size '${newSize}' is not allowed for category '${finalMajorCategory}'.`,
                        });
                    }
                }
            }

            // Do not force-overwrite user-edited season/year on every save.
            // Only auto-fill defaults when BOTH are absent in payload and missing in DB.
            if (data.year === undefined && data.season === undefined) {
                const currentSeason = ApproverController.getCurrentSeasonConfig();
                if (!existingItem.year || String(existingItem.year).trim() === '') {
                    data.year = currentSeason.yearFull;
                }
                if (!existingItem.season || String(existingItem.season).trim() === '') {
                    data.season = currentSeason.seasonCode;
                }
            }

            // Article Description: merge ordered attribute values with '-' separator,
            // max 40 chars, starting from yarn1 and skipping empty values.
            // collar is only included when it is visible in the article card for this major category.
            const descriptionSource: any = {};
            for (const field of ARTICLE_DESCRIPTION_SOURCE_FIELDS) {
                descriptionSource[field] = data[field] !== undefined ? data[field] : (existingItem as any)[field];
            }
            const majCatForDescCheck = data.majorCategory ?? (existingItem as any).majorCategory;
            if (!isComboParent) {
                data.articleDescription = buildArticleDescription(descriptionSource, 40, {
                    excludeFields: await getExcludedDescriptionFields(majCatForDescCheck) as any,
                });
            }

            let updated = await prisma.extractionResultFlat.update({
                where: { id },
                data
            });

            // Combo/set: a child edit re-derives its parent's summed costs and
            // mirrored (Top) attributes; a parent edit (e.g. major category) too.
            const comboParentToRecompute = existingItem.comboRole === 'CHILD' ? existingItem.comboParentId : isComboParent ? id : null;
            if (comboParentToRecompute) {
                await recomputeComboParent(comboParentToRecompute);
                if (isComboParent) updated = (await prisma.extractionResultFlat.findUnique({ where: { id } }))!;
            }

            // Record per-field history (fire-and-forget)
            void ApproverController.recordFgArticleHistory(id, req.user, data, oldRow)
                .catch((err: any) => console.error('[fgArticleHistory] record failed:', err?.message));

            // NOTE: We intentionally update ONLY this edited row. The correct
            // mcCode/hsnTaxCode for the new majorCategory are already applied to
            // this row above (data.mcCode / data.hsnTaxCode) and saved via the
            // single-row update. We do NOT propagate to every other article in
            // the category — that previously re-stamped the whole category (incl.
            // approved/SAP-synced rows) and bumped their updated_at en masse.

            // If variantColor was updated on a non-generic, sync colour field too
            if (!existingItem.isGeneric && data.variantColor !== undefined) {
                data.colour = data.variantColor;
                await prisma.extractionResultFlat.update({
                    where: { id },
                    data: { colour: data.variantColor }
                });
            }

            if (rebuildSizes) {
                try {
                    const { colors, created } = await rebuildVariantsForMajCat(updated, rebuildSizes);
                    console.log(`[MajCatChange] ${id}: ${oldMajCat} → ${newMajCat}, rebuilt ${created} variants for ${colors.join(', ')}`);
                } catch (err: any) {
                    console.error('[MajCatChange] variant rebuild failed:', err?.message);
                }
            }

            // If this is a generic article being updated, sync changes to variants (fire-and-forget)
            if (existingItem.isGeneric) {
                void syncGenericToVariants(existingItem.id, data).catch((err: any) => console.error('[syncGenericToVariants] failed:', err?.message));
            }

            return res.json(updated);
        } catch (error) {
            console.error('Error updating item:', error);
            return res.status(500).json({ error: 'Failed to update item' });
        }
    }

    // Modify an already-created (SAP-synced) article.
    //
    // Flow: build the SAP `Changes` payload from the edited fields → call the
    // SAP patch-bulk API → ONLY if SAP applies them successfully, persist the
    // same fields to our local DB. If SAP rejects, the DB is left untouched and
    // the SAP error is returned so the user can fix the value and retry.
    //
    // Unlike updateItem, this is allowed on APPROVED articles (that is the whole
    // point — Created Articles are APPROVED + SAP-synced).
    // Validate changes against National Grid without touching SAP or the DB.
    // Returns 200 { valid: true } or 422 { error, details }.
    static async validateModify(req: Request, res: Response) {
        try {
            const changes = req.body?.changes;
            if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
                return res.status(400).json({ error: 'changes object is required' });
            }

            // Vendor change (EXTWG): admin only, and the code must be in the vendor master.
            if (changes.vendorCode != null && String(changes.vendorCode).trim() !== '') {
                if (String(req.user?.role || '') !== 'ADMIN') {
                    return res.status(403).json({ error: 'Only an admin can change the vendor of a created article.' });
                }
                if (!isValidVendorCode(changes.vendorCode)) {
                    return res.status(400).json({ error: 'Vendor Code must be exactly 6 digits.' });
                }
                const code = normalizeVendorCode(changes.vendorCode) ?? '';
                const vendor = await prisma.masterVendorDetail.findUnique({ where: { vendorCode: code }, select: { vendorCode: true } });
                if (!vendor) {
                    return res.status(400).json({ error: `Vendor code ${code} was not found in the vendor master.` });
                }
            }

            // Build SAP key → value map (mirrors modifyItem logic)
            const attrMap: Record<string, string | null | undefined> = {};
            for (const [field, value] of Object.entries(changes)) {
                const sapKey = FLAT_TO_SAP_KEY[field];
                if (sapKey) attrMap[sapKey] = value == null ? null : String(value);
            }

            const gridResult = await validateAgainstNationalGrid(prisma, attrMap);
            if (!gridResult.valid) {
                return res.status(422).json({
                    error: 'One or more attribute values are not allowed per the National Grid.',
                    details: gridResult.errors,
                });
            }
            return res.json({ valid: true });
        } catch (err: any) {
            return res.status(500).json({ error: err?.message ?? 'Validation error' });
        }
    }

    static async modifyItem(req: Request, res: Response) {
        ApproverController.itemsCache.clear();
        ApproverController.countCache.clear();
        try {
            const { id } = req.params;
            const changes = req.body?.changes;
            const skipSap: boolean = req.body?.skipSap === true;

            if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) {
                return res.status(400).json({ error: 'No changes provided' });
            }

            // Created-article identity/price fields are LOCKED — they are set at
            // creation time and must never change on modify (neither in SAP nor in
            // the local DB). Silently ignore any attempt to edit them.
            // Exception: ADMIN users may change the vendor code (sent to SAP as
            // EXTWG); the vendor name then follows from the vendor master.
            const isAdmin = String(req.user?.role || '') === 'ADMIN';
            const MODIFY_LOCKED_FIELDS = new Set<string>([
                ...(isAdmin ? [] : ['vendorCode', 'vendorName']), // EXTWG — admin only
                'mrp',           // MRP
                'rate',          // cost / PURCH_PRICE
                'colour',        // colour
                'designNumber',  // design / DSG_NO
                'division',      // division (MENS/LADIES/…)
                'subDivision',   // sub-division / SUB_DIV
                'majorCategory', // major category
                'segment',       // segment / PRICE_BAND_CATEGORY
            ]);

            // Whitelist + coerce the incoming fields (mirrors updateItem).
            const data: any = {};
            for (const field of ITEM_UPDATE_ALLOWED_FIELDS) {
                if (MODIFY_LOCKED_FIELDS.has(field)) continue;
                if (changes[field] === undefined) continue;
                let value = changes[field];
                if (field === 'rate' || field === 'mrp') {
                    value = value === '' || value === null || value === undefined ? null : parseNumericValue(value);
                } else if (field === 'weight') {
                    value = ApproverController.extractNumericWeight(value);
                } else if (field === 'vendorCode') {
                    if (!hasVendorCode(value) || !isValidVendorCode(value)) {
                        return res.status(400).json({ error: 'Vendor Code is required and must be exactly 6 digits.' });
                    }
                    value = normalizeVendorCode(value);
                } else if (VADD_JSON_FIELDS.has(field)) {
                    value = parseVaddJson(value);
                } else if (value === '') {
                    value = null;
                }
                data[field] = value;
            }

            // Vendor name always follows the vendor code (from the vendor master) —
            // never accepted on its own.
            delete data.vendorName;

            if (Object.keys(data).length === 0) {
                return res.status(400).json({ error: 'No valid fields to modify' });
            }

            // Load the FULL article record: every SAP-mapped field is needed so
            // the modify payload can carry all of them (not just the diff), plus
            // the description-source fields and a few control fields.
            const existingItem = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: {
                    id: true,
                    sapArticleId: true,
                    approvalStatus: true,
                    division: true,
                    subDivision: true,
                    majorCategory: true,
                    mrp: true,
                    isGeneric: true,
                    ...Object.fromEntries(FLAT_TO_RFC.map((m) => [m.flat, true])),
                    vaddPrintJson: true, vaddEmpJson: true,
                    ...Object.fromEntries(ARTICLE_DESCRIPTION_SOURCE_FIELDS.map((f) => [f, true])),
                } as any,
            });

            if (!existingItem) {
                return res.status(404).json({ error: 'Item not found' });
            }

            // RBAC: same division / sub-division scoping as updateItem.
            const role = String(req.user?.role || '');
            if (role === 'APPROVER' || role === 'CATEGORY_HEAD' || role === 'CREATOR' || role === 'SUB_DIVISION_HEAD') {
                const existingDivision = ApproverController.normalizeText((existingItem as any).division);
                const existingSubDivision = ApproverController.normalizeText((existingItem as any).subDivision);
                const userDivisionVariants = ApproverController.getDivisionVariants(req.user?.division);
                const userSubDivisionVariants = ApproverController.getSubDivisionVariants(req.user?.subDivision);
                if (userDivisionVariants.length > 0 && !userDivisionVariants.includes(existingDivision)) {
                    return res.status(403).json({ error: 'Access denied: Division mismatch' });
                }
                if ((role === 'APPROVER' || role === 'CREATOR' || role === 'SUB_DIVISION_HEAD') && userSubDivisionVariants.length > 0 && existingSubDivision && !userSubDivisionVariants.includes(existingSubDivision)) {
                    return res.status(403).json({ error: 'Access denied: Sub-Division mismatch' });
                }
            }

            const matnr = (existingItem as any).sapArticleId ? String((existingItem as any).sapArticleId).trim() : '';
            if (!matnr) {
                return res.status(400).json({ error: 'This article has no SAP article number yet, so it cannot be modified in SAP.' });
            }

            // Admin vendor change: the code must exist in the vendor master; its name
            // is saved with it. Unchanged codes are dropped from the update.
            let vendorCodeChanged = false;
            if (data.vendorCode !== undefined) {
                if (data.vendorCode === normalizeVendorCode((existingItem as any).vendorCode)) {
                    delete data.vendorCode;
                } else {
                    const vendor = await prisma.masterVendorDetail.findUnique({
                        where: { vendorCode: data.vendorCode },
                        select: { vendorName: true },
                    });
                    if (!vendor?.vendorName) {
                        return res.status(400).json({ error: `Vendor code ${data.vendorCode} was not found in the vendor master.` });
                    }
                    data.vendorName = vendor.vendorName;
                    vendorCodeChanged = true;
                }
                if (Object.keys(data).length === 0) {
                    return res.status(400).json({ error: 'No valid fields to modify' });
                }
            }

            // ── National Grid validation: reject if any submitted attribute value is not in grid ──
            {
                // Map camelCase data keys → SAP attribute names for grid lookup
                const attrMap: Record<string, string | null | undefined> = {};
                for (const [field, value] of Object.entries(data)) {
                    const sapKey = FLAT_TO_SAP_KEY[field];
                    if (sapKey) attrMap[sapKey] = value == null ? null : String(value);
                }
                const gridResult = await validateAgainstNationalGrid(prisma, attrMap);
                if (!gridResult.valid) {
                    return res.status(422).json({
                        error: 'One or more attribute values are not allowed per the National Grid.',
                        details: gridResult.errors,
                    });
                }
            }

            let sapResult: { applied: number; message: string } = { applied: 0, message: 'Skipped (RFC proxy already applied)' };

            if (!skipSap) {
                // ── Build the FULL Changes payload from the merged record. ──
                const mergedItem = { ...(existingItem as any), ...data };
                const sapChanges = await buildModifyChangesPayload(mergedItem);

                for (const k of ['HSN_CODE', 'SUB_DIV', 'MC_CD', 'SEASON', 'PRICE_BAND_CATEGORY', 'PURCH_PRICE', 'NET_WEIGHT', 'VENDOR', 'MRP', 'DSG_NO', 'ARTICLE_DES1']) {
                    delete (sapChanges as any)[k];
                }
                // Vendor code on an existing article is the EXTWG attribute in SAP.
                if (vendorCodeChanged) sapChanges.EXTWG = String(data.vendorCode);

                // ── Call SAP FIRST. Only persist locally on success. ──
                const result = await patchArticleAttributes(matnr, sapChanges);
                if (!result.ok) {
                    return res.status(502).json({ error: result.message || 'SAP modification failed', sap: result.raw });
                }
                sapResult = { applied: result.applied, message: result.message };
            }

            // Rebuild article description from the merged attribute values.
            const descriptionSource: any = {};
            for (const field of ARTICLE_DESCRIPTION_SOURCE_FIELDS) {
                descriptionSource[field] = data[field] !== undefined ? data[field] : (existingItem as any)[field];
            }
            const majCatForDescCheck = data.majorCategory ?? (existingItem as any).majorCategory;
            data.articleDescription = buildArticleDescription(descriptionSource, 40, {
                excludeFields: await getExcludedDescriptionFields(majCatForDescCheck) as any,
            });

            // ── Audit log: compute per-field diff and store in modify_logs ──
            const modGroupId = randomUUID();
            const auditEntries: {
                modificationGroupId: string;
                articleNumber: string;
                labelName: string;
                oldValue: string | null;
                newValue: string | null;
                modifiedByName: string;
                modifiedByEmail: string;
                sapStatus: string;
            }[] = [];

            for (const [field, newVal] of Object.entries(data)) {
                // articleDescription is auto-rebuilt from other fields — not a user label change
                if (field === 'articleDescription') continue;
                const oldVal = (existingItem as any)[field];
                // V. ADD JSON columns: log the JSON text (DbNull → null)
                const asText = (v: unknown) =>
                    v == null || v === Prisma.DbNull ? null : VADD_JSON_FIELDS.has(field) ? JSON.stringify(v) : String(v);
                const oldStr = asText(oldVal);
                const newStr = asText(newVal);
                if (oldStr === newStr) continue;
                auditEntries.push({
                    modificationGroupId: modGroupId,
                    articleNumber: matnr,
                    labelName: FLAT_TO_SAP_KEY[field] ?? field,
                    oldValue: oldStr,
                    newValue: newStr,
                    modifiedByName: req.user?.name ?? 'Unknown',
                    modifiedByEmail: req.user?.email ?? 'unknown@unknown.com',
                    sapStatus: 'SUCCESS', // correct for both paths: skipSap=true means frontend already confirmed SAP success
                });
            }

            if (auditEntries.length > 0) {
                // Fire-and-forget: audit failure must never block a successful SAP+DB modify
                void prisma.modifyLog.createMany({ data: auditEntries }).catch((err: any) =>
                    console.error('[modifyLog] audit insert failed:', err?.message),
                );
            }

            const updated = await prisma.extractionResultFlat.update({ where: { id }, data });

            // Keep variants in sync for generic articles (fire-and-forget)
            if ((existingItem as any).isGeneric) {
                void syncGenericToVariants((existingItem as any).id, data).catch((err: any) => console.error('[syncGenericToVariants] modify failed:', err?.message));
            }

            return res.json({ ...updated, sapModify: sapResult });
        } catch (error) {
            console.error('Error modifying item:', error);
            return res.status(500).json({ error: 'Failed to modify item' });
        }
    }

    // ─── Combo/Set articles (Kurti Set, Baba Suit, ...) ──────────────────────────
    // SRM sends each piece (Baba Suit, Top, Lower) as its own row; comboLinkService
    // links them by presentation + design number. Children are real articles
    // with their own major category, created in SAP after the parent (their old
    // article / BISMT is set to the parent's number, setLinkService); the parent's
    // costs are the sum of its children and its attributes mirror the Top child
    // (recomputeComboParent). Submitting goes through approveItems on the parent.

    // GET /combo-articles/:parentId — parent row + its ordered children.
    static getComboArticle = async (req: Request, res: Response) => {
        const { parentId } = req.params;
        const existing = await prisma.extractionResultFlat.findUnique({ where: { id: parentId }, select: { id: true } });
        if (!existing) return res.status(404).json({ error: 'Parent article not found' });

        // Lazily link sets imported before linking existed.
        await linkComboGroupForRow(parentId);

        const parent = await prisma.extractionResultFlat.findUnique({ where: { id: parentId } });
        const children = await prisma.extractionResultFlat.findMany({
            where: { comboParentId: parentId, comboRole: 'CHILD' },
            orderBy: { comboChildOrder: 'asc' },
        });
        return res.json({ parent, children, primaryChildId: children[0]?.id ?? null });
    };

    // POST /combo-articles/:parentId/children — add a missing piece by hand
    // (fallback for when SRM didn't send one), cloning context from the parent.
    static addComboChild = async (req: Request, res: Response) => {
        const { parentId } = req.params;
        const parent = await prisma.extractionResultFlat.findUnique({ where: { id: parentId } });
        if (!parent) return res.status(404).json({ error: 'Parent article not found' });
        if (!(await getSetMcIndex()).isSetCategory(parent.majorCategory)) {
            return res.status(400).json({ error: `Major category "${parent.majorCategory ?? ''}" is not an active set category in the Set MC Master.` });
        }
        if (parent.approvalStatus !== 'PENDING') {
            return res.status(400).json({ error: 'This combo article has already been submitted — cannot add more children.' });
        }

        const existingCount = await prisma.extractionResultFlat.count({ where: { comboParentId: parentId, comboRole: 'CHILD' } });

        if (parent.comboRole !== 'PARENT') {
            await prisma.extractionResultFlat.update({ where: { id: parentId }, data: { comboRole: 'PARENT' } });
        }

        const child = await prisma.extractionResultFlat.create({
            data: {
                comboRole: 'CHILD',
                comboParentId: parentId,
                comboChildOrder: existingCount + 1,
                presentationsType: parent.presentationsType,
                source: parent.source,
                pptNumber: parent.pptNumber,
                vendorName: parent.vendorName,
                vendorCode: parent.vendorCode,
                division: parent.division,
                subDivision: parent.subDivision,
                designNumber: parent.designNumber,
                season: parent.season,
                year: parent.year,
                imageUrl: parent.imageUrl,
                isGeneric: true,
                isOldArticle: false,
                approvalStatus: 'PENDING',
                sapSyncStatus: 'NOT_SYNCED',
                userName: parent.userName,
            },
        });
        ApproverController.itemsCache.clear();
        return res.status(201).json(child);
    };

    // DELETE /combo-articles/children/:childId — remove a manually-added piece.
    // Pieces that came from SRM can't be deleted here.
    static deleteComboChild = async (req: Request, res: Response) => {
        const { childId } = req.params;
        const child = await prisma.extractionResultFlat.findUnique({ where: { id: childId } });
        if (!child || child.comboRole !== 'CHILD') return res.status(404).json({ error: 'Child article not found' });
        if (child.srmUniqueId || child.srmOriginalDesignNumber) {
            return res.status(400).json({ error: 'This part came from SRM and cannot be removed.' });
        }
        if (child.approvalStatus !== 'PENDING') {
            return res.status(400).json({ error: 'This part has already been submitted and cannot be removed.' });
        }

        await prisma.extractionResultFlat.delete({ where: { id: childId } });
        if (child.comboParentId) await recomputeComboParent(child.comboParentId);
        ApproverController.itemsCache.clear();
        return res.json({ success: true });
    };

    static async approveItems(req: Request, res: Response) {
        ApproverController.itemsCache.clear();
        ApproverController.countCache.clear();
        try {
            const { ids: requestedIds } = req.body; // Array of UUIDs
            if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
                return res.status(400).json({ error: 'No items selected' });
            }

            // @ts-ignore - Assuming userId is added to req by auth middleware
            const userId = req.user?.id;

            // Combo/set articles are submitted as a whole: a selected child maps to
            // its parent, and a parent brings all its children along. The parent is
            // created in SAP first; runApprovalSyncTick holds each child until its
            // parent is SYNCED, then links the child to it (setLinkService).
            const ids: string[] = [...requestedIds];
            {
                const comboRows = await prisma.extractionResultFlat.findMany({
                    where: { id: { in: requestedIds }, comboRole: { in: ['PARENT', 'CHILD'] } },
                    select: { id: true, comboRole: true, comboParentId: true },
                });
                const parentIds = new Set<string>();
                for (const r of comboRows) {
                    if (r.comboRole === 'PARENT') parentIds.add(r.id);
                    else if (r.comboParentId) parentIds.add(r.comboParentId);
                }
                // A set is created in SAP under the S- MCs of the Set MC Master: the
                // parent under its set MC, each part under its S- MC within that set.
                // Every set is checked before anything is approved.
                const setIndex = await getSetMcIndex();
                const setProblemList: string[] = [];
                const setMcWrites: { id: string; mcCode: string; hsnCode: string | null }[] = [];
                for (const parentId of parentIds) {
                    const parent = await prisma.extractionResultFlat.findUnique({
                        where: { id: parentId },
                        select: { majorCategory: true, designNumber: true, approvalStatus: true },
                    });
                    const children = await prisma.extractionResultFlat.findMany({
                        where: { comboParentId: parentId, comboRole: 'CHILD' },
                        select: { id: true, majorCategory: true, designNumber: true },
                    });
                    if (children.length === 0) {
                        return res.status(422).json({ error: 'COMBO_WITHOUT_CHILDREN', detail: 'This set article has no parts linked yet.' });
                    }
                    if (parent?.approvalStatus === 'PENDING') {
                        const problems = setProblems(
                            setIndex,
                            parent.majorCategory,
                            children.map((c) => ({ label: c.designNumber || c.majorCategory || c.id, majorCategory: c.majorCategory })),
                        );
                        if (problems.length > 0) {
                            setProblemList.push(...problems.map((p) => `${parent.designNumber || parentId}: ${p}`));
                        } else {
                            const setMc = setIndex.parentMc(parent.majorCategory)!;
                            setMcWrites.push({ id: parentId, mcCode: setMc.mcCode, hsnCode: setMc.hsnCode });
                            for (const c of children) {
                                // Parts keep their normal maj cat MC unless SET_PARTS_USE_SET_MC.
                                const partMc = SET_PARTS_USE_SET_MC
                                    ? setIndex.partMc(parent.majorCategory, c.majorCategory)!
                                    : await normalMcForCategory(c.majorCategory);
                                if (partMc) setMcWrites.push({ id: c.id, mcCode: partMc.mcCode, hsnCode: partMc.hsnCode });
                            }
                        }
                    }
                    await recomputeComboParent(parentId);
                    for (const id of [parentId, ...children.map((c) => c.id)]) {
                        if (!ids.includes(id)) ids.push(id);
                    }
                }
                if (setProblemList.length > 0) {
                    return res.status(422).json({ error: 'SET_MC_MISSING', detail: setProblemList.join('; '), problems: setProblemList });
                }
                // Show the S- MC on the article itself (the SAP payload derives it again).
                for (const w of setMcWrites) {
                    await prisma.extractionResultFlat.update({ where: { id: w.id }, data: { mcCode: w.mcCode, hsnTaxCode: w.hsnCode } });
                }
            }

            // ── Auto-generate color variants from the BOM colour ──────────────────
            // On "Save & Submit" the approver approves directly; before approval we
            // create one variant per Major-Category size for each generic's BOM
            // colour (idempotent — addColorVariants skips combos that already
            // exist, e.g. those added manually via "Add Color"). If a generic has a
            // colour but its Major Category has no sizes configured, block with a
            // clear message since no variants could be created.
            const genericsToVariant = await prisma.extractionResultFlat.findMany({
                // Set parents and set parts both get colour × size variants (each from its own category's sizes).
                where: { id: { in: ids }, isGeneric: true },
                select: { id: true, colour: true, majorCategory: true, articleNumber: true, imageName: true },
            });
            for (const g of genericsToVariant) {
                if (!g.colour || !g.colour.trim()) continue; // no colour → approve generic as-is
                const sizes = await getSizesForMajCat(g.majorCategory || '');
                if (sizes.length === 0) {
                    const label = g.articleNumber || g.imageName || g.id;
                    return res.status(422).json({
                        error: 'NO_SIZES_FOR_CATEGORY',
                        detail: `No sizes are configured for "${g.majorCategory ?? ''}" (article ${label}). Add them in the Size Master before submitting.`,
                    });
                }
                await addColorVariants(g.id, g.colour.trim());
            }

            const whereClause: any = {
                id: { in: ids },
                approvalStatus: 'PENDING',
            };

            // RBAC: Enforce scope by role
            ApproverController.applyApproverScope(whereClause, req.user);

            // Lightweight pre-approval fill: only fix missing mcCode/hsnTaxCode on the exact rows being approved
            const rowsToFix = await prisma.extractionResultFlat.findMany({
                where: { ...whereClause, mcCode: null, majorCategory: { not: null } },
                select: { id: true, majorCategory: true }
            });
            for (const row of rowsToFix) {
                const mcRow = await prisma.majorCategoryDetails.findFirst({
                    where: { mcDes: { equals: (row.majorCategory || '').trim(), mode: 'insensitive' }, mcStatus: 'ACT' },
                    select: { mcCode: true, hsnCode: true },
                });
                if (mcRow?.mcCode) {
                    void prisma.extractionResultFlat.update({
                        where: { id: row.id },
                        data: { mcCode: mcRow.mcCode, hsnTaxCode: mcRow.hsnCode || null }
                    }).catch((err: any) => console.error('[pre-approval mcCode fix] update failed:', err?.message));
                }
            }

            // Approve the generics and QUEUE them for background SAP sync
            // (sapSyncStatus = PENDING). The SAP RFC runs in the background worker
            // (runApprovalSyncTick) so this request returns instantly.
            const result = await prisma.extractionResultFlat.updateMany({
                where: whereClause,
                data: {
                    approvalStatus: 'APPROVED',
                    approvedBy: userId ? Number(userId) : null,
                    approvedAt: new Date(),
                    sapSyncStatus: SapSyncStatus.PENDING,
                }
            });

            // Approve their variants too (also queued for SAP sync).
            const approvedGenericIds = (await prisma.extractionResultFlat.findMany({
                where: { id: { in: ids }, isGeneric: true, approvalStatus: 'APPROVED' },
                select: { id: true },
            })).map((r) => r.id);
            if (approvedGenericIds.length > 0) {
                // Variants live in fg_variants_article_data
                await prisma.fgVariantArticleData.updateMany({
                    where: { genericArticleId: { in: approvedGenericIds }, approvalStatus: 'PENDING' },
                    data: {
                        approvalStatus: 'APPROVED',
                        approvedBy: userId ? Number(userId) : null,
                        approvedAt: new Date(),
                        sapSyncStatus: SapSyncStatus.PENDING,
                    },
                });
            }

            // Clear any stale sync lease left over from a previous attempt so the
            // worker can claim this article immediately on (re-)approval. Without
            // this, a re-submit after a failed sync stays stuck PENDING until the
            // old lease expires. (sap_lock_until is maintained via raw SQL.)
            await prisma.$executeRawUnsafe(
                'UPDATE public.extraction_results_flat SET sap_lock_until = NULL WHERE id = ANY($1::text[]) OR generic_article_id = ANY($1::text[])',
                ids,
            );

            ApproverController.itemsCache.clear();
            ApproverController.countCache.clear();

            // Dev aid: log the exact ZMM_ART_CREATION_RFC payload that WOULD be sent
            // for each approved generic — WITHOUT calling SAP. Fire-and-forget so it
            // never delays the 202. Lets you inspect the payload locally even when the
            // background sync worker isn't running (ENABLE_CRON=false).
            if (approvedGenericIds.length > 0) {
                prisma.extractionResultFlat.findMany({
                    where: { id: { in: approvedGenericIds } },
                    select: { id: true, majorCategory: true, comboRole: true, comboParentId: true, ...Object.fromEntries(FLAT_TO_RFC.map((m) => [m.flat, true])) } as any,
                })
                    .then((rows) => previewRfcPayloads(rows as any))
                    .catch((e: any) => console.error('[ZMM_RFC preview] failed:', e?.message));
            }

            // 202 Accepted — approved and queued; the worker performs the SAP sync.
            return res.status(202).json({
                message: 'Approved and queued for SAP creation',
                count: result.count,
                queued: result.count,
            });
        } catch (error) {
            console.error('Error approving items:', error);
            return res.status(500).json({ error: 'Failed to approve items' });
        }
    }

    // In-process guard so the approval-sync worker never overlaps itself.
    private static _approvalSyncRunning = false;

    /**
     * Background SAP sync for approved-but-unsynced articles (sapSyncStatus=PENDING).
     * On SAP failure the generic and its variants are reverted to PENDING approval
     * (so the article returns to New Articles for correction), keeping
     * sapSyncStatus=FAILED + sapSyncMessage so the UI can show why.
     */
    static async syncApprovedToSap(genericIds: string[]): Promise<{ synced: number; failed: number }> {
        const ids = genericIds;
        if (ids.length === 0) return { synced: 0, failed: 0 };
        try {
            const approvedItems = await prisma.extractionResultFlat.findMany({
                where: {
                    id: { in: ids },
                    approvalStatus: 'APPROVED'
                },
                select: {
                    id: true, articleNumber: true, majorCategory: true, division: true,
                    subDivision: true, vendorCode: true, vendorName: true, designNumber: true,
                    pptNumber: true, rate: true, mrp: true, macroMvgr: true, mainMvgr: true,
                    yarn1: true, fabricMainMvgr: true, weave: true, mFab2: true, composition: true,
                    finish: true, gsm: true, weight: true, lycra: true, shade: true, neck: true,
                    neckDetails: true, sleeve: true, length: true, collar: true, collarStyle: true,
                    placket: true, sleeveFold: true, mSet: true, bottomFold: true, frontOpenStyle: true,
                    pocketType: true, noOfPocket: true, extraPocket: true, drawcord: true,
                    dcShape: true, button: true, btnColour: true, zipper: true, zipColour: true,
                    fatherBelt: true, childBelt: true, printType: true, printStyle: true,
                    printPlacement: true, patches: true, patchesType: true, embroidery: true,
                    embroideryType: true, embPlacement: true, htrfType: true, htrfStyle: true,
                    wash: true, fit: true, pattern: true, segment: true, ageGroup: true, mNoOfSize: true, mNoOfClr: true,
                    articleFashionType: true, mvgrBrandVendor: true, fCount: true,
                    fConstruction: true, fOunce: true, fWidth: true, fabDiv: true, fabVdr: true, impAtrbt2: true,
                    autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                    roughRatio: true, roughConsumptionKg: true, roughConsumptionMeter: true,
                    preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
                    cuttingBgtPrVal: true, cuttingActPrVal: true, cuttingVendorPrVal: true, cuttingFinalPrVal: true,
                    stitchingBgtPrVal: true, stitchingActPrVal: true, stitchingVendorPrVal: true, stitchingFinalPrVal: true,
                    ironingBgtPrVal: true, ironingActPrVal: true, ironingVendorPrVal: true, ironingFinalPrVal: true,
                    finishingBgtPrVal: true, finishingActPrVal: true, finishingVendorPrVal: true, finishingFinalPrVal: true, totalBgtPrVal: true, totalActPrVal: true, totalVendorPrVal: true, totalFinalPrVal: true,
                    bTrimType: true, bTrimTotalAutoBgt: true, bTrimTotalRoughV2: true, bTrimTotalVdrCost: true, bTrimTotalFinalCost: true,
                    mBtnAutoBgt: true, mBtnRoughV2: true, mBtnVdrCost: true, mBtnFinalCost: true,
                    dcAutoBgt: true, dcRoughV2: true, dcVdrCost: true, dcFinalCost: true,
                    zipAutoBgt: true, zipRoughV2: true, zipVdrCost: true, zipFinalCost: true,
                    patchAutoBgt: true, patchRoughV2: true, patchVdrCost: true, patchFinalCost: true,
                    hTrfAutoBgt: true, hTrfRoughV2: true, hTrfVdrCost: true, hTrfFinalCost: true,
                    elasticAutoBgt: true, elasticRoughV2: true, elasticVdrCost: true, elasticFinalCost: true,
                    fusingAutoBgt: true, fusingRoughV2: true, fusingVdrCost: true, fusingFinalCost: true,
                    badgeAutoBgt: true, badgeRoughV2: true, badgeVdrCost: true, badgeFinalCost: true,
                    rivetAutoBgt: true, rivetRoughV2: true, rivetVdrCost: true, rivetFinalCost: true,
                    tapeAutoBgt: true, tapeRoughV2: true, tapeVdrCost: true, tapeFinalCost: true,
                    otherAutoBgt: true, otherRoughV2: true, otherVdrCost: true, otherFinalCost: true,
                    adjusterAutoBgt: true, adjusterRoughV2: true, adjusterVdrCost: true, adjusterFinalCost: true,
                    brotchAutoBgt: true, brotchRoughV2: true, brotchVdrCost: true, brotchFinalCost: true,
                    buckleAutoBgt: true, buckleRoughV2: true, buckleVdrCost: true, buckleFinalCost: true,
                    eyeletsAutoBgt: true, eyeletsRoughV2: true, eyeletsVdrCost: true, eyeletsFinalCost: true,
                    hangingDRingAutoBgt: true, hangingDRingRoughV2: true, hangingDRingVdrCost: true, hangingDRingFinalCost: true,
                    hookAutoBgt: true, hookRoughV2: true, hookVdrCost: true, hookFinalCost: true,
                    labelAutoBgt: true, labelRoughV2: true, labelVdrCost: true, labelFinalCost: true,
                    laceAutoBgt: true, laceRoughV2: true, laceVdrCost: true, laceFinalCost: true,
                    pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true, pockettingFabricVdrCost: true, pockettingFabricFinalCost: true,
                    pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true, pockettingReadymadeVdrCost: true, pockettingReadymadeFinalCost: true,
                    santaAutoBgt: true, santaRoughV2: true, santaVdrCost: true, santaFinalCost: true,
                    stopperAutoBgt: true, stopperRoughV2: true, stopperVdrCost: true, stopperFinalCost: true,
                    tagAutoBgt: true, tagRoughV2: true, tagVdrCost: true, tagFinalCost: true,
                    tasselsAutoBgt: true, tasselsRoughV2: true, tasselsVdrCost: true, tasselsFinalCost: true,
                    mBtnRate: true, mBtnQty: true, dcRate: true, dcQty: true, zipRate: true, zipQty: true, patchRate: true, patchQty: true, hTrfRate: true, hTrfQty: true, elasticRate: true, elasticQty: true, fusingRate: true, fusingQty: true, badgeRate: true, badgeQty: true, rivetRate: true, rivetQty: true, tapeRate: true, tapeQty: true, otherRate: true, otherQty: true, adjusterRate: true, adjusterQty: true, brotchRate: true, brotchQty: true, buckleRate: true, buckleQty: true, eyeletsRate: true, eyeletsQty: true, hangingDRingRate: true, hangingDRingQty: true, hookRate: true, hookQty: true, labelRate: true, labelQty: true, laceRate: true, laceQty: true, pockettingFabricRate: true, pockettingFabricQty: true, pockettingReadymadeRate: true, pockettingReadymadeQty: true, santaRate: true, santaQty: true, stopperRate: true, stopperQty: true, tagRate: true, tagQty: true, tasselsRate: true, tasselsQty: true,
                    printAutoBgt: true, printRoughV2: true, printVendorCost: true, printFinalCost: true,
                    embAutoBgt: true, embRoughV2: true, embVendorCost: true, embFinalCost: true,
                    washingAutoBgt: true, washingRoughV2: true, washingVendorCost: true, washingFinalCost: true,
                    vaddTotalAutoBgt: true, vaddTotalRoughV2: true, vaddTotalVendorCost: true, vaddTotalFinalCost: true,
                    pkgCostType: true, boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                    kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                    mcCode: true, hsnTaxCode: true, articleDescription: true, fashionGrid: true,
                    season: true, year: true, articleType: true, referenceArticleNumber: true,
                    referenceArticleDescription: true, imageUrl: true, imageName: true,
                    sapArticleId: true, isGeneric: true, genericArticleId: true,
                    colour: true, variantSize: true, variantColor: true,
                    attrArticleNums: true, source: true, createdAt: true,
                    srmUniqueId: true,
                    // set articles: buildRfcPayload sends their S- MC (Set MC Master)
                    comboRole: true, comboParentId: true,
                    approver: { select: { name: true } },
                }
            });

            const syncResults = await syncArticlesToSapViaRfc(approvedItems);
            const approvedItemById = new Map(approvedItems.map((item) => [item.id, item]));

            // Phase 1: Persist SAP article creation/sync outcome first.
            const finalizedSyncResults = syncResults.map((syncResult: any) => ({ ...syncResult }));

            const syncUpdates = finalizedSyncResults.map((syncResult: any) => {
                const data: any = {
                    sapSyncStatus: syncResult.success ? SapSyncStatus.SYNCED : SapSyncStatus.FAILED,
                    sapSyncMessage: syncResult.message
                };

                if (syncResult.sapArticleNumber) {
                    data.sapArticleId = syncResult.sapArticleNumber;
                    data.articleNumber = syncResult.sapArticleNumber;
                }

                if (syncResult.approvedImageUrl) {
                    data.imageUrl = syncResult.approvedImageUrl;
                }

                return prisma.extractionResultFlat.update({
                    where: { id: syncResult.id },
                    data
                });
            });

            if (syncUpdates.length > 0) {
                await prisma.$transaction(syncUpdates);
            }

            // Write SAP article number back to raw_articles if the flat record came from SRM flow
            const rawArticleWritebacks = finalizedSyncResults
                .filter((r: any) => r.success && r.sapArticleNumber)
                .map((r: any) => {
                    const approvedItem = approvedItemById.get(r.id);
                    return approvedItem?.srmUniqueId
                        ? prisma.rawArticle.update({
                            where: { id: approvedItem.srmUniqueId },
                            data:  { articleNumber: r.sapArticleNumber },
                          })
                        : null;
                })
                .filter(Boolean) as any[];

            if (rawArticleWritebacks.length > 0) {
                await prisma.$transaction(rawArticleWritebacks);
                console.log(`[APPROVE] Wrote article numbers back to ${rawArticleWritebacks.length} raw_articles row(s)`);
            }

            // Set parts just created: write the set parent's article number into the
            // part's old article (BISMT) in SAP, one part at a time. A failure is kept on
            // the part and retried by the sync tick; it never undoes the part's creation.
            for (const r of finalizedSyncResults) {
                if (!r.success || !r.sapArticleNumber || approvedItemById.get(r.id)?.comboRole !== 'CHILD') continue;
                await linkSetPart(r.id).catch((err: any) => console.error(`[SetLink] ${r.id}:`, err?.message));
            }

            // Fetch all variants for successfully synced generics before Phase 2,
            // so we can upload their images immediately alongside the generic.
            // Combines variants from both extraction_results_flat and fg_variants_article_data.
            const earlySuccessIds = finalizedSyncResults
                .filter((r: any) => r.success && r.sapArticleNumber)
                .map((r: any) => r.id);
            type VariantImgRow = { id: string; genericArticleId: string | null; variantColor: string | null; colour: string | null; imageUrl: string | null; _isFgVariant?: boolean };
            const variantsForUpload: VariantImgRow[] = [];
            if (earlySuccessIds.length > 0) {
                const fgVars = await prisma.fgVariantArticleData.findMany({
                    where: { genericArticleId: { in: earlySuccessIds } },
                    select: { id: true, genericArticleId: true, variantColor: true, imageUrl: true },
                });
                variantsForUpload.push(...fgVars.map((v) => ({ ...v, colour: null, _isFgVariant: true as const })));
            }
            // Group variants by their generic's DB id
            const variantsByGenericId_img = new Map<string, VariantImgRow[]>();
            for (const v of variantsForUpload) {
                const gId = v.genericArticleId!;
                if (!variantsByGenericId_img.has(gId)) variantsByGenericId_img.set(gId, []);
                variantsByGenericId_img.get(gId)!.push(v);
            }

            // Phase 2: Upload approved image only after article creation is persisted.
            // Also upload all variant images here using generic SAP number + variant color.
            await Promise.all(finalizedSyncResults.map(async (syncResult: any) => {
                if (!syncResult.success || !syncResult.sapArticleNumber) {
                    return null;
                }

                const approvedItem = approvedItemById.get(syncResult.id);
                if (!approvedItem?.imageUrl) {
                    console.warn(`⚠️ Approved image upload skipped for ${syncResult.id}: no source imageUrl in DB`);
                    await prisma.extractionResultFlat.update({
                        where: { id: syncResult.id },
                        data: {
                            sapSyncMessage: `${syncResult.message} | Approved image upload skipped: source image URL missing`
                        }
                    });
                    return null;
                }

                const baseArticleNumber = String(syncResult.sapArticleNumber).replace(/^0+/, '');

                // Upload generic image (with watermark)
                try {

                    const labelData: WatermarkLabel = {
                        article_number: String(syncResult.sapArticleNumber),
                        presentation_no: approvedItem.pptNumber ?? null,
                        vendor_code: approvedItem.vendorCode ?? null,
                        vendor_name: approvedItem.vendorName ?? null,
                        division: approvedItem.division ?? null,
                        sub_division: approvedItem.subDivision ?? null,
                        major_category: approvedItem.majorCategory ?? null,
                        design_number: approvedItem.designNumber ?? null,
                        mc_code: approvedItem.mcCode ?? null,
                        hsn_tax_code: approvedItem.hsnTaxCode ?? null,
                        fabric: approvedItem.macroMvgr ?? null,
                        season: approvedItem.season ?? null,
                        year: approvedItem.year ?? null,
                        rate: approvedItem.rate != null ? Number(approvedItem.rate) : null,
                        mrp: approvedItem.mrp != null ? Number(approvedItem.mrp) : null,
                        approved_by: (approvedItem as any).approver?.name ?? null,
                    };

                    const approvedImageUpload = await storageService.uploadApprovedImageFromSourceUrl(
                        String(approvedItem.imageUrl),
                        String(syncResult.sapArticleNumber),
                        labelData,
                    );

                    await prisma.extractionResultFlat.update({
                        where: { id: syncResult.id },
                        data: { imageUrl: approvedImageUpload.url }
                    });
                } catch (error: any) {
                    console.error(`❌ Approved image upload failed for ${syncResult.id}:`, error?.message);
                    await prisma.extractionResultFlat.update({
                        where: { id: syncResult.id },
                        data: {
                            sapSyncMessage: `${syncResult.message} | Approved image upload failed: ${error?.message || 'unknown error'}`
                        }
                    });
                }

                // Upload variant images using generic SAP number + variant color.
                // This runs independently of variant RFC sync — we have everything needed:
                // the generic's SAP number (base) and each variant's color code.
                const variants = variantsByGenericId_img.get(syncResult.id) || [];
                const variantsToUpload = variants.filter(
                    v => v.imageUrl && !storageService.extractApprovedKeyFromUrl(v.imageUrl)
                );
                await Promise.allSettled(variantsToUpload.map(async (v) => {
                    const colorCode = v.variantColor || v.colour || undefined;
                    try {
                        const upload = await storageService.uploadApprovedImageFromSourceUrl(
                            String(v.imageUrl),
                            baseArticleNumber,
                            undefined,
                            colorCode ?? undefined,
                        );
                        if (v._isFgVariant) {
                            await prisma.fgVariantArticleData.update({ where: { id: v.id }, data: { imageUrl: upload.url } });
                        } else {
                            await prisma.extractionResultFlat.update({ where: { id: v.id }, data: { imageUrl: upload.url } });
                        }
                    } catch (imgErr: any) {
                        console.error(`❌ [VARIANT_IMG] Upload failed for ${v.id}:`, imgErr?.message);
                    }
                }));

                return null;
            }));

            const syncedCount = finalizedSyncResults.filter((r: any) => r.success).length;
            const failedCount = finalizedSyncResults.length - syncedCount;

            const failedIds = finalizedSyncResults
                .filter((r) => !r.success)
                .map((r) => r.id);

            // On SAP failure, send the article back to the approver: revert the
            // generic AND its variants to PENDING approval so it reappears in New
            // Articles for correction. sapSyncStatus stays FAILED + sapSyncMessage
            // (persisted above) so the UI can show why it failed.
            if (failedIds.length > 0) {
                // Revert to PENDING for re-work, but KEEP approvedBy/approvedAt so the
                // Failed Creations page can scope "who tried" (user-specific). The
                // generic keeps sapSyncStatus=FAILED (+message) from the persist above.
                await prisma.extractionResultFlat.updateMany({
                    where: { id: { in: failedIds } },
                    data: { approvalStatus: ApprovalStatus.PENDING },
                });
                // Revert its variants (fg_variants_article_data)
                await prisma.fgVariantArticleData.updateMany({
                    where: { genericArticleId: { in: failedIds } },
                    data: { approvalStatus: ApprovalStatus.PENDING, sapSyncStatus: SapSyncStatus.NOT_SYNCED },
                });

                // Set: a failed parent sends its parts back too — they wait for it in the
                // queue and would never be created without it.
                const failedParents = await prisma.extractionResultFlat.findMany({
                    where: { id: { in: failedIds }, comboRole: 'PARENT' },
                    select: { id: true },
                });
                for (const p of failedParents) {
                    const waiting = await prisma.extractionResultFlat.findMany({
                        where: { comboParentId: p.id, comboRole: 'CHILD', approvalStatus: 'APPROVED', sapSyncStatus: SapSyncStatus.PENDING },
                        select: { id: true },
                    });
                    if (waiting.length === 0) continue;
                    const waitingIds = waiting.map((w) => w.id);
                    await prisma.extractionResultFlat.updateMany({
                        where: { id: { in: waitingIds } },
                        data: {
                            approvalStatus: ApprovalStatus.PENDING,
                            sapSyncStatus: SapSyncStatus.FAILED,
                            sapSyncMessage: 'The set (parent) article failed in SAP — fix it and re-submit the set.',
                        },
                    });
                    await prisma.fgVariantArticleData.updateMany({
                        where: { genericArticleId: { in: waitingIds }, approvalStatus: 'APPROVED', sapSyncStatus: SapSyncStatus.PENDING },
                        data: { approvalStatus: ApprovalStatus.PENDING, sapSyncStatus: SapSyncStatus.NOT_SYNCED },
                    });
                }

                // Combo/set: a failed child sends its (still queued) parent back too,
                // so the whole set returns to New Articles and is re-submitted together.
                // (The parent is created first now, so this only applies to a parent that
                // is still waiting; a created parent stays and only the part is re-submitted.)
                const failedChildren = await prisma.extractionResultFlat.findMany({
                    where: { id: { in: failedIds }, comboRole: 'CHILD', comboParentId: { not: null } },
                    select: { comboParentId: true, majorCategory: true },
                });
                for (const c of failedChildren) {
                    await prisma.extractionResultFlat.updateMany({
                        where: { id: c.comboParentId!, approvalStatus: 'APPROVED', sapSyncStatus: SapSyncStatus.PENDING },
                        data: {
                            approvalStatus: ApprovalStatus.PENDING,
                            sapSyncStatus: SapSyncStatus.FAILED,
                            sapSyncMessage: `Set part ${c.majorCategory ?? ''} failed in SAP — fix it and re-submit the set.`,
                        },
                    });
                    await prisma.fgVariantArticleData.updateMany({
                        where: { genericArticleId: c.comboParentId!, approvalStatus: 'APPROVED', sapSyncStatus: SapSyncStatus.PENDING },
                        data: { approvalStatus: ApprovalStatus.PENDING, sapSyncStatus: SapSyncStatus.NOT_SYNCED },
                    });
                }
            }
            const successfullyApprovedIds = ids.filter((id: string) => !failedIds.includes(id));

            // ── Variant RFC sync ─────────────────────────────────────────────
            // For each successfully synced generic article, create its color/size
            // variants in SAP via ZMM_VAR_ART_CREATION_RFC.
            // Variants are read from fg_variants_article_data.
            if (successfullyApprovedIds.length > 0) {
                try {
                    const fgTableVariants = await prisma.fgVariantArticleData.findMany({
                        where: { genericArticleId: { in: successfullyApprovedIds } },
                        select: {
                            id: true, genericArticleId: true, variantSize: true,
                            variantColor: true, vendorCode: true,
                            rate: true, mrp: true, variantArticleNumber: true,
                            approvalStatus: true, sapSyncStatus: true, imageUrl: true,
                        },
                    });

                    const fgVariantIdSet = new Set(fgTableVariants.map((v) => v.id));

                    const allVariants = [
                        ...fgTableVariants.map((v) => ({
                            ...v,
                            colour: v.variantColor,
                            sapArticleId: v.variantArticleNumber ?? null,
                            articleNumber: v.variantArticleNumber ?? null,
                        })),
                    ];

                    if (allVariants.length > 0) {
                        const variantsByGenericId = new Map<string, typeof allVariants>();
                        for (const variant of allVariants) {
                            const gId = variant.genericArticleId!;
                            if (!variantsByGenericId.has(gId)) variantsByGenericId.set(gId, []);
                            variantsByGenericId.get(gId)!.push(variant);
                        }

                        const genericSapArticleMap = new Map<string, string>();
                        for (const syncResult of finalizedSyncResults) {
                            if (syncResult.success && syncResult.sapArticleNumber) {
                                genericSapArticleMap.set(syncResult.id, syncResult.sapArticleNumber);
                            }
                        }
                        const variantSyncResults = await syncVariantsToSapViaRfc(variantsByGenericId, genericSapArticleMap);

                        const variantSyncUpdates = variantSyncResults.map((vResult: any) => {
                            const isFgVariant = fgVariantIdSet.has(vResult.id);
                            const data: any = {
                                sapSyncStatus: vResult.success ? SapSyncStatus.SYNCED : SapSyncStatus.FAILED,
                                sapSyncMessage: vResult.message,
                            };
                            if (vResult.sapArticleNumber) {
                                if (isFgVariant) {
                                    data.variantArticleNumber = vResult.sapArticleNumber;
                                } else {
                                    data.sapArticleId = vResult.sapArticleNumber;
                                    data.articleNumber = vResult.sapArticleNumber;
                                }
                            }
                            if (!isFgVariant) {
                                if (vResult.success && vResult.fabricArticleNumber) data.fabricArticleNumber = vResult.fabricArticleNumber;
                                if (vResult.success && vResult.fabricArticleDescription) data.fabricArticleDescription = vResult.fabricArticleDescription;
                            }
                            return isFgVariant
                                ? prisma.fgVariantArticleData.update({ where: { id: vResult.id }, data })
                                : prisma.extractionResultFlat.update({ where: { id: vResult.id }, data });
                        });

                        if (variantSyncUpdates.length > 0) {
                            await Promise.allSettled(variantSyncUpdates);
                        }

                        // Tell PO-Wise now instead of in 2-3 h via Snowflake. Fire-and-forget:
                        // it never throws and never fails article creation.
                        void sendHandoffToPoWise(() => Array.from(variantsByGenericId.entries()).map(([gId, vs]) =>
                            buildHandoffArticle(approvedItemById.get(gId) ?? {}, genericSapArticleMap.get(gId), vs, variantSyncResults)));
                    }
                } catch (varErr: any) {
                    console.error('[VARIANT_RFC] Variant sync failed (non-fatal):', varErr?.message);
                    // Mark stuck-PENDING variants as FAILED so the retry worker can pick them up
                    await prisma.fgVariantArticleData.updateMany({
                        where: {
                            genericArticleId: { in: successfullyApprovedIds },
                            variantArticleNumber: null,
                        },
                        data: {
                            sapSyncStatus: SapSyncStatus.FAILED,
                            sapSyncMessage: `Variant RFC exception: ${varErr?.message ?? 'unknown'}`,
                        },
                    }).catch(() => {});
                }
            }
            // ─────────────────────────────────────────────────────────────────

            // Build failure details so the caller knows exactly what SAP rejected
            const failureDetails = finalizedSyncResults
                .filter((r: any) => !r.success)
                .map((r: any) => ({ id: r.id, message: r.message || 'SAP sync failed' }));

            void failureDetails; // per-item SAP errors are persisted on each row's sapSyncMessage
            return { synced: syncedCount, failed: failedCount };
        } catch (error: any) {
            console.error('[ApprovalSync] syncApprovedToSap error:', error?.message);
            return { synced: 0, failed: genericIds.length };
        }
    }

    /**
     * Background worker tick — claims a batch of APPROVED + PENDING(sync) generics
     * and runs their SAP creation. Multi-process safe: the claim is atomic
     * (FOR UPDATE SKIP LOCKED) with a lease (sap_lock_until) so two workers never
     * grab the same row and a crashed worker's rows are reclaimed once the lease
     * expires. Batch/lease are env-configurable.
     */
    static async runApprovalSyncTick(): Promise<{ processed: number; synced: number; failed: number }> {
        if (ApproverController._approvalSyncRunning) {
            return { processed: 0, synced: 0, failed: 0 };
        }
        ApproverController._approvalSyncRunning = true;
        try {
            const batchSize = parseInt(process.env.APPROVAL_SYNC_BATCH || '10', 10);
            const lockMinutes = parseInt(process.env.APPROVAL_SYNC_LOCK_MINUTES || '15', 10);
            const lockUntil = new Date(Date.now() + lockMinutes * 60_000); // computed in JS — no SQL interval fn

            const claimed = await prisma.$queryRaw<{ id: string }[]>`
                UPDATE public.extraction_results_flat
                SET sap_lock_until = ${lockUntil}
                WHERE id IN (
                    SELECT e.id FROM public.extraction_results_flat e
                    WHERE e.is_generic = true
                      AND e.approval_status::text = 'APPROVED'
                      AND e.sap_sync_status::text = 'PENDING'
                      AND (e.sap_lock_until IS NULL OR e.sap_lock_until < NOW())
                      -- Set part waits until its set parent exists in SAP: the part's old
                      -- article (BISMT) is set to the parent's number right after it is
                      -- created (setLinkService).
                      AND NOT EXISTS (
                          SELECT 1 FROM public.extraction_results_flat p
                          WHERE e.combo_role::text = 'CHILD'
                            AND p.id = e.combo_parent_id
                            AND (p.sap_sync_status::text <> 'SYNCED' OR p.sap_article_id IS NULL)
                      )
                    ORDER BY e.approved_at ASC
                    LIMIT ${batchSize}
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id
            `;
            // Set parts created earlier whose old-article link failed or never ran.
            await retryPendingSetLinks().catch((err: any) => console.error('[SetLink] retry error:', err?.message));
            if (claimed.length === 0) return { processed: 0, synced: 0, failed: 0 };
            const ids = claimed.map((c) => c.id);

            const remaining = await prisma.extractionResultFlat.count({
                where: { isGeneric: true, approvalStatus: 'APPROVED', sapSyncStatus: SapSyncStatus.PENDING },
            });

            const r = await ApproverController.syncApprovedToSap(ids);
            ApproverController.itemsCache.clear();
            ApproverController.countCache.clear();
            return { processed: ids.length, ...r };
        } catch (err: any) {
            console.error('[ApprovalSync] tick error:', err?.message);
            return { processed: 0, synced: 0, failed: 0 };
        } finally {
            ApproverController._approvalSyncRunning = false;
        }
    }


    // Re-queue FAILED generics for the background worker. Only generics never
    // created in SAP (sapArticleId IS NULL) are re-queued — never a duplicate.
    static async retrySapSync(req: Request, res: Response) {
        try {
            const { ids } = req.body;
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'No items selected' });
            }
            const result = await prisma.extractionResultFlat.updateMany({
                where: {
                    id: { in: ids },
                    isGeneric: true,
                    approvalStatus: 'APPROVED',
                    sapSyncStatus: SapSyncStatus.FAILED,
                    sapArticleId: null,
                },
                data: { sapSyncStatus: SapSyncStatus.PENDING },
            });
            await prisma.$executeRawUnsafe(
                'UPDATE public.extraction_results_flat SET sap_lock_until = NULL WHERE id = ANY($1::text[])',
                ids,
            );
            ApproverController.itemsCache.clear();
            ApproverController.countCache.clear();
            return res.json({ success: true, requeued: result.count });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Reject items
    static async rejectItems(req: Request, res: Response) {
        ApproverController.itemsCache.clear();
        ApproverController.countCache.clear();
        try {
            const { ids } = req.body;
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'No items selected' });
            }

            // @ts-ignore
            const userId = req.user?.id;

            const whereClause: any = {
                id: { in: ids }
            };

            // RBAC: Enforce scope by role
            ApproverController.applyApproverScope(whereClause, req.user);

            const result = await prisma.extractionResultFlat.updateMany({
                where: whereClause,
                data: {
                    approvalStatus: 'REJECTED',
                    sapSyncStatus: SapSyncStatus.NOT_SYNCED,
                    sapSyncMessage: 'Rejected by approver',
                    approvedBy: userId ? Number(userId) : null,
                    approvedAt: new Date()
                }
            });

            // Auto-reject all variants of rejected generic articles
            const rejectedIds = ids;
            const variantsToReject = await prisma.fgVariantArticleData.findMany({
                where: { genericArticleId: { in: rejectedIds } },
                select: { id: true }
            });
            await prisma.fgVariantArticleData.updateMany({
                where: { genericArticleId: { in: rejectedIds } },
                data: {
                    approvalStatus: 'REJECTED',
                    sapSyncStatus: SapSyncStatus.NOT_SYNCED,
                    sapSyncMessage: 'Rejected with generic article',
                    approvedBy: userId ? Number(userId) : null,
                    approvedAt: new Date(),
                },
            });

            return res.json({
                message: 'Items rejected',
                count: result.count
            });
        } catch (error) {
            console.error('Error rejecting items:', error);
            return res.status(500).json({ error: 'Failed to reject items' });
        }
    }

    // Push generic's colour to all variants that have no variantColor set
    static async syncColorToVariants(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const generic = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: { id: true, colour: true, isGeneric: true }
            });
            if (!generic?.isGeneric) return res.status(400).json({ error: 'Not a generic article' });
            if (!generic.colour) return res.json({ message: 'Generic has no colour to sync', count: 0 });

            const result = await prisma.fgVariantArticleData.updateMany({
                where: { genericArticleId: id, variantColor: null },
                data: { variantColor: generic.colour }
            });
            return res.json({ message: `Synced colour to ${result.count} variants`, count: result.count });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Get all variants for a generic article — from fg_variants_article_data only
    // (the old extraction_results_flat variants were copied there with the same ids).
    static async getVariants(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const fgVariants = await prisma.fgVariantArticleData.findMany({
                where: { genericArticleId: id },
                orderBy: [{ variantColor: 'asc' }, { variantSize: 'asc' }],
                take: 5000,
            });

            // Map fg_variants_article_data rows to the same shape extractionResultFlat uses
            const mappedFgVariants = fgVariants.map((v) => ({
                ...v,
                isGeneric: false,
                colour: v.variantColor,
                size: v.variantSize,
                sapArticleId: v.variantArticleNumber ?? null,
                articleNumber: v.variantArticleNumber ?? null,
            }));

            const combined = mappedFgVariants;
            combined.sort((a, b) => {
                const ca = (a.variantColor ?? '').localeCompare(b.variantColor ?? '');
                return ca !== 0 ? ca : (a.variantSize ?? '').localeCompare(b.variantSize ?? '');
            });

            return res.json({ data: combined });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Retry SAP sync for FAILED / NOT_SYNCED / PENDING variants of a generic article.
    // Also retroactively uploads images for SYNCED variants whose image is not yet in article-master.
    static async retryVariants(req: Request, res: Response) {
        try {
            const { id } = req.params;

            // 1. Load the generic article
            const generic = await prisma.extractionResultFlat.findUnique({ where: { id } });
            if (!generic || !generic.isGeneric) {
                return res.status(404).json({ error: 'Generic article not found' });
            }
            if (!generic.sapArticleId) {
                return res.status(400).json({ error: 'Generic article has no SAP article number. Approve the generic first.' });
            }

            // Human-readable base number: strip leading zeros from generic SAP ID
            // e.g. "0000001110143051" → "1110143051"
            const genericBaseNum = String(generic.sapArticleId).replace(/^0+/, '');

            // 2. Retroactive image upload — runs ALWAYS, even if no variants need SAP sync.
            //    Fixes SYNCED variants whose imageUrl still points to the main bucket.
            const allSyncedFgVariants = await prisma.fgVariantArticleData.findMany({
                where: {
                    genericArticleId: id,
                    sapSyncStatus: 'SYNCED',
                    variantArticleNumber: { not: null },
                },
                select: { id: true, imageUrl: true, variantColor: true }
            });
            const allSyncedVariants = allSyncedFgVariants.map(v => ({ ...v, colour: null as string | null }));
            const needsRetroUpload = allSyncedVariants.filter(
                (v) => v.imageUrl && !storageService.extractApprovedKeyFromUrl(v.imageUrl)
            );
            const fgSyncedIdSet = new Set(allSyncedFgVariants.map(v => v.id));
            if (needsRetroUpload.length > 0) {
                await Promise.allSettled(needsRetroUpload.map(async (v) => {
                    const colorCode = v.variantColor || v.colour || undefined;
                    try {
                        const upload = await storageService.uploadApprovedImageFromSourceUrl(
                            String(v.imageUrl),
                            genericBaseNum,
                            undefined,
                            colorCode ?? undefined,
                        );
                        const updateData = { imageUrl: upload.url };
                        if (fgSyncedIdSet.has(v.id)) {
                            await prisma.fgVariantArticleData.update({ where: { id: v.id }, data: updateData });
                        } else {
                            await prisma.extractionResultFlat.update({ where: { id: v.id }, data: updateData });
                        }
                    } catch (imgErr: any) {
                        console.error(`❌ [RETRY_VARIANTS] Retroactive upload failed for ${v.id}:`, imgErr?.message);
                    }
                }));
            }

            // 3. Find variants that need (re)syncing to SAP
            const fgVariantsRaw = await prisma.fgVariantArticleData.findMany({
                where: {
                    genericArticleId: id,
                    variantArticleNumber: null,
                    sapSyncStatus: { in: ['FAILED', 'NOT_SYNCED', 'PENDING', 'SYNCED'] }
                }
            });

            // Normalize fgVariants to match the extractionResultFlat shape expected by syncVariantsToSapViaRfc
            const fgVariantIdSet = new Set(fgVariantsRaw.map(v => v.id));
            const fgVariantsNormalized = fgVariantsRaw.map(v => ({
                ...v,
                colour: v.variantColor,
                sapArticleId: v.variantArticleNumber ?? null,
                articleNumber: v.variantArticleNumber ?? null,
                isGeneric: false,
                fabricArticleNumber: null,
                fabricArticleDescription: null,
            }));

            // Auto-approve PENDING variants
            const pendingFgVariants = await prisma.fgVariantArticleData.findMany({
                where: { genericArticleId: id, approvalStatus: 'PENDING' }
            });

            if (pendingFgVariants.length > 0) {
                const userId = (req as any).user?.id;
                await prisma.fgVariantArticleData.updateMany({
                    where: { id: { in: pendingFgVariants.map(v => v.id) } },
                    data: {
                        approvalStatus: 'APPROVED',
                        approvedBy: userId ? Number(userId) : null,
                        approvedAt: new Date(),
                        sapSyncStatus: 'NOT_SYNCED'
                    }
                });
            }

            const pendingFgNormalized = pendingFgVariants
                .filter(p => !fgVariantIdSet.has(p.id))
                .map(v => ({
                    ...v,
                    colour: v.variantColor,
                    sapArticleId: v.variantArticleNumber ?? null,
                    articleNumber: v.variantArticleNumber ?? null,
                    isGeneric: false,
                    fabricArticleNumber: null,
                    fabricArticleDescription: null,
                }));

            const allToSync = [
                ...fgVariantsNormalized,
                ...pendingFgNormalized,
            ];

            if (allToSync.length === 0) {
                return res.json({
                    message: needsRetroUpload.length > 0
                        ? `No SAP sync needed; uploaded ${needsRetroUpload.length} missing variant image(s) to article-master`
                        : 'No variants need SAP sync',
                    synced: 0,
                    failed: 0
                });
            }

            // Track which ids came from fg_variant_article_data for correct update routing
            const allFgVariantIds = new Set([
                ...fgVariantsRaw.map(v => v.id),
                ...pendingFgVariants.map(v => v.id),
            ]);

            // 4. Build maps for syncVariantsToSapViaRfc
            const variantsByGenericId = new Map([[id, allToSync]]);
            const genericSapArticleMap = new Map([[id, generic.sapArticleId]]);

            // 5. Call the existing RFC function
            const results = await syncVariantsToSapViaRfc(variantsByGenericId, genericSapArticleMap);

            // 6. Persist results back to DB — route to correct table
            await Promise.allSettled(results.map(r => {
                const isFgVariant = allFgVariantIds.has(r.id);
                const data: Record<string, unknown> = {
                    sapSyncStatus: r.success ? SapSyncStatus.SYNCED : SapSyncStatus.FAILED,
                    sapSyncMessage: r.message
                };
                if (r.sapArticleNumber) {
                    if (isFgVariant) {
                        data.variantArticleNumber = r.sapArticleNumber;
                    } else {
                        data.sapArticleId = r.sapArticleNumber;
                        data.articleNumber = r.sapArticleNumber;
                    }
                }
                if (!isFgVariant) {
                    if (r.success && r.fabricArticleNumber) data.fabricArticleNumber = r.fabricArticleNumber;
                    if (r.success && r.fabricArticleDescription) data.fabricArticleDescription = r.fabricArticleDescription;
                }
                return isFgVariant
                    ? prisma.fgVariantArticleData.update({ where: { id: r.id }, data })
                    : prisma.extractionResultFlat.update({ where: { id: r.id }, data });
            }));

            // Tell PO-Wise now instead of in 2-3 h via Snowflake (fire-and-forget, never throws).
            void sendHandoffToPoWise(() => [buildHandoffArticle(generic, generic.sapArticleId, allToSync, results)]);

            // 7. Upload images for newly synced variants
            const variantById = new Map(allToSync.map((v: any) => [v.id, v]));
            await Promise.allSettled(
                results
                    .filter((r: any) => r.success && r.sapArticleNumber)
                    .map(async (r: any) => {
                        const variant = variantById.get(r.id);
                        if (!variant?.imageUrl) {
                            console.warn(`⚠️ [RETRY_VARIANTS] Image upload skipped for ${r.id}: no imageUrl`);
                            return;
                        }
                        const colorCode = variant.variantColor || variant.colour || undefined;
                        try {
                            const upload = await storageService.uploadApprovedImageFromSourceUrl(
                                String(variant.imageUrl),
                                genericBaseNum,
                                undefined,
                                colorCode ?? undefined,
                            );
                            const isFg = allFgVariantIds.has(r.id);
                            if (isFg) {
                                await prisma.fgVariantArticleData.update({ where: { id: r.id }, data: { imageUrl: upload.url } });
                            } else {
                                await prisma.extractionResultFlat.update({ where: { id: r.id }, data: { imageUrl: upload.url } });
                            }
                        } catch (imgErr: any) {
                            console.error(`❌ [RETRY_VARIANTS] Variant image upload failed for ${r.id}:`, imgErr?.message);
                        }
                    })
            );

            const synced = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            console.log(`[RETRY_VARIANTS] generic=${id} synced=${synced} failed=${failed}`);
            return res.json({
                message: `Retry complete: ${synced} synced, ${failed} failed`,
                synced,
                failed,
                results: results.map(r => ({ id: r.id, success: r.success, message: r.message, sapArticleNumber: r.sapArticleNumber }))
            });
        } catch (err: any) {
            console.error('[RETRY_VARIANTS] Error:', err.message);
            return res.status(500).json({ error: err.message });
        }
    }

    // Duplicate an existing article — creates a new PENDING copy with the supplied design number
    static async duplicateItem(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { designNumber } = req.body as { designNumber?: string };
            if (!designNumber || !designNumber.trim()) {
                return res.status(400).json({ error: 'Design Number is required to duplicate an article.' });
            }
            const source = await prisma.extractionResultFlat.findUnique({ where: { id } });
            if (!source) return res.status(404).json({ error: 'Article not found' });

            // Fetch original job for metadata
            const originalJob = source.jobId
                ? await prisma.extractionJob.findUnique({
                    where: { id: source.jobId },
                    select: { categoryId: true, userId: true, aiModel: true },
                })
                : null;
            if (!originalJob) return res.status(404).json({ error: 'Source job not found' });

            // Create a new ExtractionJob for the duplicate
            const newJob = await prisma.extractionJob.create({
                data: {
                    userId: originalJob.userId,
                    categoryId: originalJob.categoryId,
                    imageUrl: source.imageUrl || '',
                    status: 'COMPLETED',
                    aiModel: originalJob.aiModel,
                    processingTimeMs: source.processingTimeMs,
                    tokensUsed: source.totalTokens,
                    inputTokens: source.inputTokens,
                    outputTokens: source.outputTokens,
                    apiCost: source.apiCost,
                    totalAttributes: source.totalAttributes,
                    extractedCount: source.extractedCount,
                    avgConfidence: source.avgConfidence,
                    completedAt: new Date(),
                    designNumber: source.articleNumber,
                },
            });

            // Strip identity / status fields — copy everything else
            const {
                id: _id,
                jobId: _jobId,
                createdAt: _createdAt,
                updatedAt: _updatedAt,
                imageUncPath: _imageUncPath,
                approvalStatus: _approvalStatus,
                approvedBy: _approvedBy,
                approvedAt: _approvedAt,
                sapSyncStatus: _sapSyncStatus,
                sapArticleId: _sapArticleId,
                sapSyncMessage: _sapSyncMessage,
                articleNumber: _articleNumber,
                fabricArticleNumber: _fabricArticleNumber,
                fabricArticleDescription: _fabricArticleDescription,
                imageExtractionRawData: _imageExtractionRawData,
                ...rest
            } = source;

            const { randomUUID } = await import('crypto');
            const newId = randomUUID();

            const newRecord = await prisma.extractionResultFlat.create({
                data: {
                    ...rest,
                    vaddPrintJson: rest.vaddPrintJson ?? Prisma.DbNull,
                    vaddEmpJson: rest.vaddEmpJson ?? Prisma.DbNull,
                    id: newId,
                    jobId: newJob.id,
                    imageUncPath: null,
                    approvalStatus: 'PENDING',
                    approvedBy: null,
                    approvedAt: null,
                    sapSyncStatus: 'NOT_SYNCED',
                    sapArticleId: null,
                    sapSyncMessage: null,
                    articleNumber: null,
                    fabricArticleNumber: null,
                    fabricArticleDescription: null,
                    designNumber: designNumber.trim(),
                    // A manual duplicate has no pending AI extraction — mark it COMPLETED
                    // so it isn't hidden by the 30-minute SRM extraction gate (which only
                    // holds back source=SRM rows still in SRM_IMPORT) and isn't re-processed
                    // (and overwritten) by the SRM raw-extraction cron.
                    extractionStatus: 'COMPLETED',
                    imageExtractionRawData: _imageExtractionRawData ?? Prisma.DbNull,
                },
            });

            console.log(`[Duplicate] Created duplicate id=${newId} from source id=${id}`);
            return res.json({ success: true, id: newRecord.id });
        } catch (err: any) {
            console.error('[Duplicate] Error:', err.message);
            return res.status(500).json({ error: err.message });
        }
    }

    // Add color variants to an existing generic article.
    // Body: { colors|color, sizes?, colorImages? } — when `sizes` is provided
    // (manual mode) only those sizes are created; otherwise all of the MC's active
    // sizes (auto mode). `colorImages` maps each color code → uploaded image URL;
    // that image is applied to every size of that color.
    static async addColor(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { color, colors, sizes, sizesByColor, colorImages } = req.body;
            // Accept either colors[] (new) or color string (legacy)
            const colorList: string[] = Array.isArray(colors)
                ? colors.map((c: string) => c.trim().toUpperCase()).filter(Boolean)
                : color?.trim()
                ? [color.trim().toUpperCase()]
                : [];

            if (colorList.length === 0) return res.status(400).json({ error: 'At least one color is required' });

            // Per-color image map (keys upper-cased to match colorList). Each color
            // must have an image — the UI uploads one before submitting.
            const imageByColor: Record<string, string> = {};
            if (colorImages && typeof colorImages === 'object') {
                for (const [k, v] of Object.entries(colorImages)) {
                    if (typeof v === 'string' && v.trim()) imageByColor[k.trim().toUpperCase()] = v.trim();
                }
            }
            const missingImg = colorList.filter((c) => !imageByColor[c]);
            if (missingImg.length > 0) {
                return res.status(422).json({
                    error: 'IMAGE_REQUIRED',
                    detail: `An image is required for each color. Missing: ${missingImg.join(', ')}.`,
                });
            }

            // Manual mode: validate requested sizes against the Major Category's
            // allowed sizes (maj_cat_sizes). Reject the whole request on any invalid size.
            // `sizesByColor` ({ COLOR: [sizes] }) picks sizes per color and wins over
            // the global `sizes` list for that color.
            const perColorSizes: Record<string, string[]> = {};
            if (sizesByColor && typeof sizesByColor === 'object') {
                for (const [k, v] of Object.entries(sizesByColor)) {
                    if (!Array.isArray(v)) continue;
                    const list = v.map((s) => String(s).trim()).filter(Boolean);
                    if (list.length > 0) perColorSizes[k.trim().toUpperCase()] = list;
                }
            }
            const requestedSizes = [
                ...(Array.isArray(sizes) ? sizes.map((s: string) => String(s).trim()).filter(Boolean) : []),
                ...Object.values(perColorSizes).flat(),
            ];
            let sizesOverride: string[] | undefined;
            if (requestedSizes.length > 0) {
                const generic = await prisma.extractionResultFlat.findUnique({
                    where: { id }, select: { majorCategory: true },
                });
                const allowed = await getSizesForMajCat(generic?.majorCategory || '');
                const allowedUpper = new Set(allowed.map((s) => s.trim().toUpperCase()));
                const invalid = [...new Set(requestedSizes.filter((s) => !allowedUpper.has(s.toUpperCase())))];
                if (invalid.length > 0) {
                    return res.status(422).json({
                        error: 'INVALID_SIZE_FOR_CATEGORY',
                        detail: `Size(s) not allowed for category '${generic?.majorCategory ?? ''}': ${invalid.join(', ')}.`,
                    });
                }
                if (Array.isArray(sizes) && sizes.length > 0) {
                    sizesOverride = sizes.map((s: string) => String(s).trim()).filter(Boolean);
                }
            }

            let totalCreated = 0;
            for (const c of colorList) {
                totalCreated += await addColorVariants(id, c, perColorSizes[c] ?? sizesOverride, imageByColor[c]);
            }
            return res.json({ message: `Created ${totalCreated} color variants`, count: totalCreated });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Auto-create variants for a color without requiring an image upload.
    // Falls back to the generic article's own image (same as the approve flow).
    // Idempotent: returns count=0 if all size+color combos already exist.
    static async ensureColorVariants(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { color } = req.body;
            const colorStr = typeof color === 'string' ? color.trim() : '';
            if (!colorStr) return res.status(400).json({ error: 'color is required' });

            const count = await addColorVariants(id, colorStr);
            return res.json({ count, alreadyExists: count === 0 });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Upload a single image (used by the Add Color flow for per-color images).
    // Receives a multipart file field `image`; stores it in R2 and returns its URL.
    static async uploadImage(req: Request, res: Response) {
        try {
            const file = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string } | undefined;
            if (!file) return res.status(400).json({ error: 'No image file provided' });
            const result = await storageService.uploadFile(
                file.buffer,
                file.originalname || 'color.jpg',
                file.mimetype || 'image/jpeg',
                'variant-colors',
            );
            return res.json({ url: result.url });
        } catch (err: any) {
            console.error('[uploadImage] Error:', err.message);
            return res.status(500).json({ error: 'Failed to upload image' });
        }
    }

    // GET /api/approver/sizes-for-majcat/:majCat
    // Returns active sizes array for the given major category (from maj_cat_sizes table)
    // FAB card: M_FAB_MAIN_MVGR_1 is filled from the chosen M_FAB_MAIN_MVGR_2 via
    // m_fabric_main_mvgr_mapping. data = null when the MVGR-2 has no mapping row.
    static async getFabricMainMvgr1(req: Request, res: Response) {
        try {
            const mvgr2 = String(req.params.mvgr2 ?? '').trim().toUpperCase();
            if (!mvgr2) return res.status(400).json({ error: 'mvgr2 is required' });
            const rows = await prisma.$queryRaw<{ mvgr1: string; mvgr1_full_form: string | null; mvgr2_full_form: string | null }[]>`
                SELECT mvgr1, mvgr1_full_form, mvgr2_full_form
                FROM m_fabric_main_mvgr_mapping
                WHERE UPPER(TRIM(mvgr2)) = ${mvgr2}
                LIMIT 1
            `;
            const r = rows[0];
            return res.json({
                data: r ? { mvgr1: r.mvgr1, mvgr1FullForm: r.mvgr1_full_form, mvgr2, mvgr2FullForm: r.mvgr2_full_form } : null,
            });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    static async getSizesForMajCat(req: Request, res: Response) {
        const { majCat } = req.params;
        const sizes = await getSizesForMajCat(majCat || '');
        return res.json({ majCat, sizes, count: sizes.length });
    }

    // GET /api/approver/colors
    // Color list for the "Add Color Variants" dropdown, from the color_master table.
    //   code   = sap_create_old (stored on the variant as its colour)
    //   name   = child_color (display name)
    //   father = father_color (family, for optional grouping)
    static async getColorMaster(_req: Request, res: Response) {
        try {
            const rows = await prisma.$queryRaw<{ code: string; name: string; father: string | null }[]>`
                SELECT sap_create_old AS code, child_color AS name, father_color AS father
                FROM color_master
                WHERE sap_create_old IS NOT NULL AND TRIM(sap_create_old) <> ''
                  AND child_color    IS NOT NULL AND TRIM(child_color)    <> ''
                ORDER BY father_color, child_color
            `;
            const colors = rows.map(r => ({
                code: String(r.code).trim(),
                name: String(r.name).trim(),
                father: r.father ? String(r.father).trim() : null,
            }));
            return res.json({ colors, count: colors.length });
        } catch (error) {
            console.error('Error fetching color master:', error);
            return res.status(500).json({ error: 'Failed to fetch colors' });
        }
    }

    // ── FG Created tab: replace image (vendors starting "V2 S") ──────────────
    // Live image = `<article>.jpg` in the approved (article-master) bucket and
    // image_url; the image it replaced is kept as `<article>_OLD.jpg` and
    // old_image_url. Only the FIRST replace writes _OLD, so it always stays the
    // photo the article was created with.
    static readonly IMAGE_REPLACE_VENDOR_PREFIX = 'V2 S';

    static canReplaceImage(vendorName: string | null | undefined): boolean {
        return String(vendorName ?? '').trim().toUpperCase().startsWith(ApproverController.IMAGE_REPLACE_VENDOR_PREFIX);
    }

    static async replaceImage(req: Request, res: Response) {
        const file = (req as any).file as { buffer: Buffer; mimetype: string } | undefined;
        if (!file?.buffer?.length) return res.status(400).json({ error: 'No image file provided' });
        const record = await prisma.extractionResultFlat.findUnique({
            where: { id: req.params.id },
            include: { approver: { select: { name: true } } },
        });
        if (!record) return res.status(404).json({ error: 'Article not found' });
        if (record.approvalStatus !== 'APPROVED' || record.sapSyncStatus !== 'SYNCED') {
            return res.status(409).json({ error: 'Only created articles can change their image' });
        }
        if (!ApproverController.canReplaceImage(record.vendorName)) {
            return res.status(403).json({ error: `Image replace is only allowed for vendors starting with "${ApproverController.IMAGE_REPLACE_VENDOR_PREFIX}"` });
        }
        const key = record.imageUrl ? storageService.approvedKeyFromAnyUrl(record.imageUrl) : null;
        if (!key) return res.status(409).json({ error: 'This article has no stored image to replace' });
        if ((await storageService.approvedObjectVersion(key)) === null) {
            return res.status(409).json({ error: `Current image ${key} was not found in storage` });
        }

        const labelData: WatermarkLabel = {
            article_number: String(record.articleNumber ?? key.replace(/\.[^.]+$/, '')),
            presentation_no: record.pptNumber ?? null,
            vendor_code: record.vendorCode ?? null,
            vendor_name: record.vendorName ?? null,
            division: record.division ?? null,
            sub_division: record.subDivision ?? null,
            major_category: record.majorCategory ?? null,
            design_number: record.designNumber ?? null,
            mc_code: record.mcCode ?? null,
            hsn_tax_code: record.hsnTaxCode ?? null,
            fabric: record.macroMvgr ?? null,
            season: record.season ?? null,
            year: record.year ?? null,
            rate: record.rate != null ? Number(record.rate) : null,
            mrp: record.mrp != null ? Number(record.mrp) : null,
            approved_by: record.approver?.name ?? null,
        };

        let oldCreated = false;
        try {
            ({ oldCreated } = await storageService.replaceApprovedImage(key, file.buffer, labelData));
        } catch (err: any) {
            console.error(`[replaceImage] ${key}:`, err?.message);
            return res.status(500).json({ error: 'Failed to replace image' });
        }

        // image_url gets a ?v= stamp so every page (and the r2.dev CDN) shows the new file.
        const oldKey = storageService.oldKeyFor(key);
        const now = Date.now();
        const imageUrl = await storageService.approvedViewUrl(key, now, record.imageUrl);
        const oldImageUrl = oldCreated || !record.oldImageUrl
            ? (await storageService.approvedViewUrl(oldKey, now, record.imageUrl)).split('?v=')[0]
            : record.oldImageUrl;
        await prisma.extractionResultFlat.update({ where: { id: record.id }, data: { imageUrl, oldImageUrl } });
        ApproverController.itemsCache.clear();
        ApproverController.countCache.clear();
        console.log(`[replaceImage] ${key} replaced by ${(req as any).user?.email ?? 'unknown'}${oldCreated ? ' (previous kept as _OLD)' : ''}`);
        return res.json({ imageUrl, oldImageUrl });
    }

    // Refresh image URL for a flat record — fixes expired signed URLs
    static async getImageUrl(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const record = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: { imageUrl: true }
            });

            if (!record?.imageUrl) {
                return res.status(404).json({ error: 'No image found for this record' });
            }

            const storedUrl = record.imageUrl;

            const publicBase = (process.env.R2_PUBLIC_URL_BASE || '').replace(/\/$/, '');
            const approvedBase = (process.env.APPROVED_R2_PUBLIC_URL_BASE || '').replace(/\/$/, '');

            // If the URL is from the approved (article-master) bucket, always generate
            // a fresh signed URL — the public URL may not be accessible if the bucket
            // does not have public access enabled in Cloudflare.
            if (approvedBase && storedUrl.startsWith(approvedBase + '/')) {
                const approvedKey = storageService.extractApprovedKeyFromUrl(storedUrl);
                if (approvedKey) {
                    const signedUrl = await storageService.getApprovedSignedUrl(approvedKey, 3600);
                    return res.json({ url: signedUrl });
                }
                // Key extraction failed — return as-is
                return res.json({ url: storedUrl });
            }

            // If it's a primary bucket public URL, return it as-is (bucket is public)
            if (publicBase && storedUrl.startsWith(publicBase + '/')) {
                return res.json({ url: storedUrl });
            }

            // Public R2 CDN URLs (hostname starts with "pub-" and ends with ".r2.dev") never
            // expire — they are served from Cloudflare's public CDN. Return as-is with no
            // key extraction, no signing, and no DB update.
            try {
                const { hostname } = new URL(storedUrl);
                if (hostname.startsWith('pub-') && hostname.endsWith('.r2.dev')) {
                    return res.json({ url: storedUrl });
                }
            } catch { /* malformed URL — fall through */ }

            // If the URL is not from any R2 domain (e.g. Supabase, external CDN), return as-is.
            // Never rewrite or persist a replacement — that would corrupt non-R2 URLs permanently.
            const isR2Url = storedUrl.includes('.r2.cloudflarestorage.com') ||
                storedUrl.includes('.r2.dev/') ||
                (publicBase && storedUrl.startsWith(publicBase)) ||
                (approvedBase && storedUrl.startsWith(approvedBase));
            if (!isR2Url) {
                return res.json({ url: storedUrl });
            }

            // Extract the object key from a signed URL (works for signed R2 URLs)
            let key: string | null = null;
            try {
                const parsed = new URL(storedUrl);
                // Signed URL path: /<bucket>/<key> or just /<key>
                let pathname = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
                const bucket = process.env.R2_BUCKET_NAME || '';
                if (bucket && pathname.startsWith(bucket + '/')) {
                    pathname = pathname.slice(bucket.length + 1);
                }
                key = pathname || null;
            } catch {
                key = null;
            }

            if (!key) {
                // Can't reconstruct — return whatever is stored
                return res.json({ url: storedUrl });
            }

            // Build a fresh public URL if base is configured, else generate a new signed URL
            let freshUrl: string;
            if (publicBase) {
                freshUrl = `${publicBase}/${key}`;
            } else {
                freshUrl = await storageService.getSignedUrl(key, 604800);
            }

            // Persist the fresh URL so future loads are instant
            await prisma.extractionResultFlat.update({
                where: { id },
                data: { imageUrl: freshUrl }
            });

            return res.json({ url: freshUrl });
        } catch (error) {
            console.error('Error refreshing image URL:', error);
            return res.status(500).json({ error: 'Failed to refresh image URL' });
        }
    }

    /**
     * GET /api/approver/vendor-search?q=<query>[&by=code]
     * Returns up to 15 vendor records matching the typed name (case-insensitive),
     * or with by=code, vendors whose code starts with the typed digits.
     * Requires at least 2 characters to avoid returning the full 8k list.
     */
    static async vendorSearch(req: Request, res: Response) {
        const q = String(req.query.q ?? '').trim();
        const byCode = req.query.by === 'code';
        if (q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        const results = await prisma.masterVendorDetail.findMany({
            where: byCode
                ? { vendorCode: { startsWith: q.replace(/^0+/, '') || q } }
                : { vendorName: { contains: q, mode: 'insensitive' } },
            select: {
                vendorCode: true,
                vendorName: true,
                vendorCity: true,
            },
            orderBy: byCode ? { vendorCode: 'asc' } : { vendorName: 'asc' },
            take: 15,
        });

        return res.json({ success: true, data: results });
    }

    /**
     * Returns the cascading Division → Sub-Division → Major Category hierarchy
     * built from the fabric_article_master table (active rows only).
     * Used by the Fabric Article edit form and dashboard filters.
     */
    static async getFabricGridValues(_req: Request, res: Response) {
        const rows = await prisma.fabricMajCatGridValue.findMany({
            orderBy: [{ characteristic: 'asc' }, { id: 'asc' }],
            select: { characteristic: true, code: true, fullForm: true },
        });

        // Map DB characteristic names → frontend Excel attr names (SCHEMA_KEY_TO_EXCEL_ATTR values)
        const DB_TO_EXCEL: Record<string, string> = {
            'FAB_MAIN_MVGR-1': 'M_FAB_MAIN_MVGR_1',
            'FAB-MAIN-MVGR-2': 'M_FAB_MAIN_MVGR_2',
            'WEAVE-01':        'M_WEAVE_01',
            'WEAVE 02':        'M_WEAVE_02',
        };

        const grouped: Record<string, { code: string; fullForm: string }[]> = {};
        for (const row of rows) {
            const key = DB_TO_EXCEL[row.characteristic] ?? row.characteristic;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({ code: row.code, fullForm: row.fullForm });
        }

        return res.json({ data: grouped });
    }

    static async getNationalGridValues(_req: Request, res: Response) {
        const rows = await prisma.nationalGridMaster.findMany({
            where: { isActive: true },
            orderBy: [{ attributeName: 'asc' }, { id: 'asc' }],
            select: { attributeName: true, code: true, fullForm: true },
        });

        // Map DB attribute_name → frontend Excel attr names where they differ
        const DB_TO_EXCEL: Record<string, string> = {
            'FAB_MAIN_MVGR-1': 'M_FAB_MAIN_MVGR_1',
            'FAB-MAIN-MVGR-2': 'M_FAB_MAIN_MVGR_2',
            'WEAVE-01':        'M_WEAVE_01',
            'WEAVE 02':        'M_WEAVE_02',
            'BODY STYLE':      'M_BODY_STYLE',
            'M_NO_OF_POCKET':  'M_NO_OF_POCKET',
        };

        const grouped: Record<string, { code: string; fullForm: string }[]> = {};
        for (const row of rows) {
            const key = DB_TO_EXCEL[row.attributeName] ?? row.attributeName;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({ code: row.code, fullForm: row.fullForm ?? row.code });
        }

        return res.json({ data: grouped });
    }

    static async getFabricArticleMasterHierarchy(_req: Request, res: Response) {
        const rows = await prisma.fabricArticleMaster.findMany({
            where: { status: 'ACT' },
            select: { div: true, subDiv: true, majCat: true, mcDes: true },
            orderBy: [{ div: 'asc' }, { subDiv: 'asc' }, { majCat: 'asc' }, { mcDes: 'asc' }],
        });

        const divSet = new Set<string>();
        const subDivsByDiv: Record<string, string[]> = {};
        const majCatsBySubDiv: Record<string, string[]> = {};
        const mcDesByMajCat: Record<string, string[]> = {};

        for (const row of rows) {
            divSet.add(row.div);

            if (!subDivsByDiv[row.div]) subDivsByDiv[row.div] = [];
            if (!subDivsByDiv[row.div].includes(row.subDiv)) subDivsByDiv[row.div].push(row.subDiv);

            if (!majCatsBySubDiv[row.subDiv]) majCatsBySubDiv[row.subDiv] = [];
            if (!majCatsBySubDiv[row.subDiv].includes(row.majCat)) majCatsBySubDiv[row.subDiv].push(row.majCat);

            if (!mcDesByMajCat[row.majCat]) mcDesByMajCat[row.majCat] = [];
            if (!mcDesByMajCat[row.majCat].includes(row.mcDes)) mcDesByMajCat[row.majCat].push(row.mcDes);
        }

        return res.json({
            divisions: Array.from(divSet),
            subDivsByDiv,
            majCatsBySubDiv,
            mcDesByMajCat,
        });
    }

    static async getGMHierarchy(req: Request, res: Response) {
        const rows = await prisma.$queryRaw<{ div: string; sub_div: string; maj_cat_nm: string; maj_cat_desc: string | null }[]>`
            SELECT DISTINCT div, sub_div, maj_cat_nm, maj_cat_desc
            FROM gm_major_category_details
            WHERE div IS NOT NULL AND sub_div IS NOT NULL AND maj_cat_nm IS NOT NULL
              AND mj_status = 'ACT'
            ORDER BY div, sub_div, maj_cat_nm
        `;

        // Scope: GM_APPROVER / GM_CREATOR with assigned sub-divisions only see their slice
        const reqUser = req.user as any;
        const isGMScoped =
            (reqUser?.role === 'GM_APPROVER' || reqUser?.role === 'GM_CREATOR') &&
            reqUser?.subDivision;
        const allowedSubDivs: Set<string> | null = isGMScoped
            ? new Set(
                String(reqUser.subDivision)
                    .split(',')
                    .map((s: string) => s.trim().toUpperCase())
                    .filter(Boolean),
              )
            : null;

        const divSet = new Set<string>();
        const subDivsByDiv: Record<string, string[]> = {};
        const majCatsBySubDiv: Record<string, string[]> = {};
        const mcDesByMajCat: Record<string, string[]> = {};

        for (const row of rows) {
            if (!row.div || !row.sub_div || !row.maj_cat_nm) continue;
            if (allowedSubDivs && !allowedSubDivs.has(row.sub_div.toUpperCase())) continue;
            divSet.add(row.div);
            if (!subDivsByDiv[row.div]) subDivsByDiv[row.div] = [];
            if (!subDivsByDiv[row.div].includes(row.sub_div)) subDivsByDiv[row.div].push(row.sub_div);
            if (!majCatsBySubDiv[row.sub_div]) majCatsBySubDiv[row.sub_div] = [];
            if (!majCatsBySubDiv[row.sub_div].includes(row.maj_cat_nm)) majCatsBySubDiv[row.sub_div].push(row.maj_cat_nm);
            if (row.maj_cat_desc) {
                if (!mcDesByMajCat[row.maj_cat_nm]) mcDesByMajCat[row.maj_cat_nm] = [];
                if (!mcDesByMajCat[row.maj_cat_nm].includes(row.maj_cat_desc)) mcDesByMajCat[row.maj_cat_nm].push(row.maj_cat_desc);
            }
        }

        return res.json({
            divisions: Array.from(divSet),
            subDivsByDiv,
            majCatsBySubDiv,
            mcDesByMajCat,
        });
    }

    static async getGMAttributes(req: Request, res: Response) {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json({ familyCodes: [] });
        const rows = await prisma.$queryRaw<{ family_code: string; family_name: string }[]>`
            SELECT DISTINCT family_code, family_name
            FROM gm_major_category_details
            WHERE maj_cat_nm = ${majorCategory} AND mj_status = 'ACT' AND status = 'ACT'
              AND family_code IS NOT NULL AND family_code <> ''
            ORDER BY family_code
        `;
        return res.json({
            familyCodes: rows.map((r) => r.family_code),
            familyAttrs: rows.map((r) => ({ code: r.family_code, name: r.family_name ?? r.family_code })),
        });
    }

    static async getGMGridValues(req: Request, res: Response) {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json({ data: [] });
        const rows = await prisma.$queryRaw<{
            family_code: string;
            family_name: string | null;
            mandatory: string | null;
            grid_val: string | null;
        }[]>`
            SELECT family_code, family_name, mandatory, grid_val
            FROM gm_major_category_grid_values
            WHERE maj_cat_nm = ${majorCategory} AND status = 'ACT'
              AND family_code IS NOT NULL AND family_code <> ''
            ORDER BY family_code, grid_val
        `;
        // Group by family_code
        const grouped = new Map<string, { familyName: string; mandatory: boolean; values: string[] }>();
        for (const row of rows) {
            if (!row.family_code) continue;
            if (!grouped.has(row.family_code)) {
                grouped.set(row.family_code, {
                    familyName: row.family_name ?? row.family_code,
                    mandatory: (row.mandatory ?? '').toUpperCase() === 'MAND',
                    values: [],
                });
            }
            if (row.grid_val && row.grid_val.trim()) {
                grouped.get(row.family_code)!.values.push(row.grid_val.trim());
            }
        }
        const data = Array.from(grouped.entries()).map(([familyCode, entry]) => ({
            familyCode,
            familyName: entry.familyName,
            mandatory: entry.mandatory,
            values: entry.values,
        }));
        return res.json({ data });
    }

    // ─── GM Article Data (gm_article_data) ───────────────────────────────────────

    private static buildGmArticleDataWhere(query: Record<string, string>) {
        const { pathType = 'new', division, subDivision, majorCategory, search, startDate, endDate } = query;
        const where: any = {};

        if (pathType === 'new') {
            where.approvalStatus = 'PENDING';
        } else if (pathType === 'rejected') {
            where.approvalStatus = 'REJECTED';
        } else if (pathType === 'created') {
            where.approvalStatus = 'APPROVED';
        } else if (pathType === 'failed') {
            where.sapSyncStatus = 'FAILED';
        }

        if (division && division !== 'ALL') where.division = { contains: division, mode: 'insensitive' };
        if (subDivision && subDivision !== 'ALL') where.subDivision = { equals: subDivision, mode: 'insensitive' };
        if (majorCategory) where.majorCategory = { equals: majorCategory, mode: 'insensitive' };

        const ss = String(query.sapSyncStatus || '').trim().toUpperCase();
        if (['SYNCED', 'PENDING', 'FAILED', 'NOT_SYNCED'].includes(ss)) where.sapSyncStatus = ss;

        const dateField = pathType === 'created' ? 'approvedAt' : 'createdAt';
        if (startDate || endDate) {
            where[dateField] = {};
            if (startDate) where[dateField].gte = new Date(startDate);
            if (endDate)   where[dateField].lte = new Date(endDate);
        }

        if (search) {
            where.OR = [
                { gmArticleNumber:      { contains: search, mode: 'insensitive' } },
                { gmArticleDescription: { contains: search, mode: 'insensitive' } },
                { vendorName:           { contains: search, mode: 'insensitive' } },
                { vendorCode:           { contains: search, mode: 'insensitive' } },
                { designNumber:         { contains: search, mode: 'insensitive' } },
                { majorCategory:        { contains: search, mode: 'insensitive' } },
            ];
        }

        return { where };
    }

    private static GM_ARTICLE_DATA_SELECT = {
        id: true,
        gmArticleNumber: true, gmArticleDescription: true, gmArticleType: true,
        division: true, subDivision: true, majorCategory: true, mcDescription: true,
        vendorName: true, vendorCode: true, designNumber: true, pptNumber: true,
        approvalStatus: true, approvedAt: true, approvedBy: true,
        sapSyncStatus: true, sapSyncMessage: true,
        imageUrl: true, backImageUrl: true, source: true, userName: true,
        rate: true, mrp: true, segment: true, articleFashionType: true, flatId: true,
        createdAt: true, updatedAt: true,
        // GM attribute columns
        gmAgeGrade: true, gmApplicator: true, gmBaseType: true, gmBatteryType: true,
        gmBpaFree: true, gmBpcForm: true, gmBrand: true, gmBrandType: true,
        gmCapacityMl: true, gmCareInstruction: true, gmCertification: true,
        gmClosureType: true, gmCoating: true, gmColourFamily: true, gmColourShade: true,
        gmCompartmentCount: true, gmComposition: true, gmCosmeticFinish: true,
        gmDiameterCm: true, gmDimStandard: true, gmDishwasherSafe: true,
        gmFoldable: true, gmFoodContactSafe: true, gmFragranceConc: true,
        gmFragranceFamily: true, gmFreeFrom: true, gmFwHeelHtCm: true,
        gmFwHeelType: true, gmFwSize: true, gmFwSole: true, gmFwToe: true,
        gmFwUpper: true, gmGsm: true, gmHeatRetentionHr: true, gmHeightCm: true,
        gmInsulationType: true, gmKeyIngredient: true, gmLeakProof: true,
        gmLengthCm: true, gmLicence: true, gmLidType: true, gmLifestage: true,
        gmLiningMaterial: true, gmManufacturer: true, gmMaterial: true,
        gmMaterialGroup: true, gmMaterialSecondary: true, gmMicrowaveSafe: true,
        gmMountType: true, gmNetContent: true, gmNetContentUom: true,
        gmNetWeightG: true, gmPackQty: true, gmPattern: true, gmPlayPattern: true,
        gmPlayerCount: true, gmPowerSource: true, gmPriceTier: true,
        gmPrintTheme: true, gmSeason: true, gmSellUom: true, gmSetContents: true,
        gmShelfLifeMonths: true, gmSkinType: true, gmSpf: true, gmSport: true,
        gmStrapType: true, gmSurfaceFinish: true, gmTextileFabric: true,
        gmThreadCount: true, gmUsageOccasion: true, gmVoltageV: true,
        gmWarrantyMonths: true, gmWattageW: true, gmWeave: true,
        gmWheelCount: true, gmWidthCm: true, gmYarn: true,
    } as const;

    private static gmArticleDataRowToItem(r: any) {
        return {
            id:                      r.id,
            isGeneric:               true,
            imageName:               null,
            imageUrl:                r.imageUrl ?? null,
            backImageUrl:            r.backImageUrl ?? null,
            articleNumber:           r.gmArticleNumber ?? null,
            fabricArticleNumber:     r.gmArticleNumber ?? null,
            fabricArticleDescription: r.gmArticleDescription ?? null,
            division:                r.division ?? null,
            subDivision:             r.subDivision ?? null,
            majorCategory:           r.majorCategory ?? null,
            mcCode:                  null,
            mcDescription:           r.mcDescription ?? null,
            vendorName:              r.vendorName ?? null,
            vendorCode:              r.vendorCode ?? null,
            designNumber:            r.designNumber ?? null,
            pptNumber:               r.pptNumber ?? null,
            approvalStatus:          (r.approvalStatus ?? 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED',
            approvedAt:              r.approvedAt?.toISOString() ?? null,
            approvedBy:              r.approvedBy ?? null,
            sapSyncStatus:           (r.sapSyncStatus ?? 'NOT_SYNCED') as any,
            sapSyncMessage:          r.sapSyncMessage ?? null,
            userName:                r.userName ?? null,
            createdAt:               r.createdAt.toISOString(),
            updatedAt:               r.updatedAt.toISOString(),
            source:                  r.source ?? null,
            mrp:                     r.mrp != null ? Number(r.mrp) : null,
            rate:                    r.rate != null ? Number(r.rate) : null,
            segment:                 r.segment ?? null,
            articleFashionType:      r.articleFashionType ?? null,
            flatId:                  r.flatId ?? null,
            // GM attribute fields — keyed by family_code (uppercase) so frontend can use attr.code directly
            GM_AGE_GRADE: r.gmAgeGrade ?? null, GM_APPLICATOR: r.gmApplicator ?? null,
            GM_BASE_TYPE: r.gmBaseType ?? null, GM_BATTERY_TYPE: r.gmBatteryType ?? null,
            GM_BPA_FREE: r.gmBpaFree ?? null, GM_BPC_FORM: r.gmBpcForm ?? null,
            GM_BRAND: r.gmBrand ?? null, GM_BRAND_TYPE: r.gmBrandType ?? null,
            GM_CAPACITY_ML: r.gmCapacityMl ?? null, GM_CARE_INSTRUCTION: r.gmCareInstruction ?? null,
            GM_CERTIFICATION: r.gmCertification ?? null, GM_CLOSURE_TYPE: r.gmClosureType ?? null,
            GM_COATING: r.gmCoating ?? null, GM_COLOUR_FAMILY: r.gmColourFamily ?? null,
            GM_COLOUR_SHADE: r.gmColourShade ?? null, GM_COMPARTMENT_COUNT: r.gmCompartmentCount ?? null,
            GM_COMPOSITION: r.gmComposition ?? null, GM_COSMETIC_FINISH: r.gmCosmeticFinish ?? null,
            GM_DIAMETER_CM: r.gmDiameterCm ?? null, GM_DIM_STANDARD: r.gmDimStandard ?? null,
            GM_DISHWASHER_SAFE: r.gmDishwasherSafe ?? null, GM_FOLDABLE: r.gmFoldable ?? null,
            GM_FOOD_CONTACT_SAFE: r.gmFoodContactSafe ?? null, GM_FRAGRANCE_CONC: r.gmFragranceConc ?? null,
            GM_FRAGRANCE_FAMILY: r.gmFragranceFamily ?? null, GM_FREE_FROM: r.gmFreeFrom ?? null,
            GM_FW_HEEL_HT_CM: r.gmFwHeelHtCm ?? null, GM_FW_HEEL_TYPE: r.gmFwHeelType ?? null,
            GM_FW_SIZE: r.gmFwSize ?? null, GM_FW_SOLE: r.gmFwSole ?? null,
            GM_FW_TOE: r.gmFwToe ?? null, GM_FW_UPPER: r.gmFwUpper ?? null,
            GM_GSM: r.gmGsm ?? null, GM_HEAT_RETENTION_HR: r.gmHeatRetentionHr ?? null,
            GM_HEIGHT_CM: r.gmHeightCm ?? null, GM_INSULATION_TYPE: r.gmInsulationType ?? null,
            GM_KEY_INGREDIENT: r.gmKeyIngredient ?? null, GM_LEAK_PROOF: r.gmLeakProof ?? null,
            GM_LENGTH_CM: r.gmLengthCm ?? null, GM_LICENCE: r.gmLicence ?? null,
            GM_LID_TYPE: r.gmLidType ?? null, GM_LIFESTAGE: r.gmLifestage ?? null,
            GM_LINING_MATERIAL: r.gmLiningMaterial ?? null, GM_MANUFACTURER: r.gmManufacturer ?? null,
            GM_MATERIAL: r.gmMaterial ?? null, GM_MATERIAL_GROUP: r.gmMaterialGroup ?? null,
            GM_MATERIAL_SECONDARY: r.gmMaterialSecondary ?? null, GM_MICROWAVE_SAFE: r.gmMicrowaveSafe ?? null,
            GM_MOUNT_TYPE: r.gmMountType ?? null, GM_NET_CONTENT: r.gmNetContent ?? null,
            GM_NET_CONTENT_UOM: r.gmNetContentUom ?? null, GM_NET_WEIGHT_G: r.gmNetWeightG ?? null,
            GM_PACK_QTY: r.gmPackQty ?? null, GM_PATTERN: r.gmPattern ?? null,
            GM_PLAY_PATTERN: r.gmPlayPattern ?? null, GM_PLAYER_COUNT: r.gmPlayerCount ?? null,
            GM_POWER_SOURCE: r.gmPowerSource ?? null, GM_PRICE_TIER: r.gmPriceTier ?? null,
            GM_PRINT_THEME: r.gmPrintTheme ?? null, GM_SEASON: r.gmSeason ?? null,
            GM_SELL_UOM: r.gmSellUom ?? null, GM_SET_CONTENTS: r.gmSetContents ?? null,
            GM_SHELF_LIFE_MONTHS: r.gmShelfLifeMonths ?? null, GM_SKIN_TYPE: r.gmSkinType ?? null,
            GM_SPF: r.gmSpf ?? null, GM_SPORT: r.gmSport ?? null,
            GM_STRAP_TYPE: r.gmStrapType ?? null, GM_SURFACE_FINISH: r.gmSurfaceFinish ?? null,
            GM_TEXTILE_FABRIC: r.gmTextileFabric ?? null, GM_THREAD_COUNT: r.gmThreadCount ?? null,
            GM_USAGE_OCCASION: r.gmUsageOccasion ?? null, GM_VOLTAGE_V: r.gmVoltageV ?? null,
            GM_WARRANTY_MONTHS: r.gmWarrantyMonths ?? null, GM_WATTAGE_W: r.gmWattageW ?? null,
            GM_WEAVE: r.gmWeave ?? null, GM_WHEEL_COUNT: r.gmWheelCount ?? null,
            GM_WIDTH_CM: r.gmWidthCm ?? null, GM_YARN: r.gmYarn ?? null,
        };
    }

    static getGmArticleItems = async (req: Request, res: Response) => {
        const query = req.query as Record<string, string>;
        const page = parseInt(query.page || '1', 10);
        const take = parseInt(query.limit || '50', 10);
        const skip = (page - 1) * take;
        const pathType = query.pathType || 'new';
        const { where } = ApproverController.buildGmArticleDataWhere(query);

        // Enforce GM user scope: restrict to their assigned sub-divisions
        const reqUser = req.user as any;
        if (
            (reqUser?.role === 'GM_APPROVER' || reqUser?.role === 'GM_CREATOR') &&
            reqUser?.subDivision
        ) {
            const allowedSubDivs = String(reqUser.subDivision)
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);
            if (allowedSubDivs.length > 0 && !where.subDivision) {
                where.AND = [
                    ...(Array.isArray(where.AND) ? where.AND : []),
                    { subDivision: { in: allowedSubDivs } },
                ];
            }
        }
        const orderBy = pathType === 'created'
            ? ({ approvedAt: { sort: 'desc', nulls: 'last' } } as const)
            : ({ createdAt: 'desc' } as const);
        const select = ApproverController.GM_ARTICLE_DATA_SELECT;
        const { rows, total } = ApproverController.isCardGroupBy(query.groupBy)
            ? await ApproverController.findGroupedPage(prisma.gmArticleData, {
                where, select, skip, take, groupBy: query.groupBy,
                dateField: pathType === 'created' ? 'approvedAt' : 'createdAt',
            })
            : await Promise.all([
                prisma.gmArticleData.findMany({ where, skip, take, orderBy, select }),
                prisma.gmArticleData.count({ where }),
            ]).then(([rows, total]) => ({ rows, total }));
        const data = rows.map((r) => ApproverController.gmArticleDataRowToItem(r));
        return res.json({ data, meta: { total, page, limit: take } });
    };

    static getGmArticleById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const row = await prisma.gmArticleData.findUnique({ where: { id } });
        if (!row) return res.status(404).json({ error: 'Item not found' });
        return res.json(ApproverController.gmArticleDataRowToItem(row));
    };

    // ── GM variants (gm_variants_article_data: one row per size × color) ──────

    // Valid sizes for a GM major category, from gm_size_master (ACT and T-ACT rows).
    private static async gmSizesForMajCat(majCat: string): Promise<string[]> {
        if (!majCat.trim()) return [];
        // Raw query: gm_size_master is read the same way in gmSizeMasterController.
        const rows = await prisma.$queryRaw<{ size: string }[]>`
            SELECT size FROM public.gm_size_master
            WHERE UPPER(TRIM(maj_cat)) = UPPER(${majCat.trim()})
            ORDER BY id ASC`;
        const seen = new Set<string>();
        return rows
            .map((r) => r.size.trim())
            .filter((s) => s && !seen.has(s.toUpperCase()) && seen.add(s.toUpperCase()));
    }

    // GET /api/approver/gm-sizes-for-majcat/:majCat
    static getGmSizesForMajCat = async (req: Request, res: Response) => {
        const sizes = await ApproverController.gmSizesForMajCat(req.params.majCat || '');
        return res.json({ majCat: req.params.majCat, sizes, count: sizes.length });
    };

    private static gmVariantRowToItem(r: any) {
        return { ...ApproverController.fabricVariantRowToItem(r), variantSize: r.variantSize ?? null };
    }

    // GET /api/approver/gm-articles/:genericId/variants
    static getGmArticleVariants = async (req: Request, res: Response) => {
        const rows = await prisma.gmVariantArticleData.findMany({
            where: { genericArticleId: req.params.genericId },
            orderBy: [{ variantColor: 'asc' }, { createdAt: 'asc' }],
        });
        return res.json({ data: rows.map((r) => ApproverController.gmVariantRowToItem(r)) });
    };

    // POST /api/approver/gm-articles/:genericId/variants
    // Body: { colors: string[], sizesByColor: { COLOR: string[] }, colorImages: { COLOR: url } }
    // Creates one row per color × size; existing (size, color) pairs are skipped.
    static addGmArticleVariants = async (req: Request, res: Response) => {
        const { genericId } = req.params;
        const { colors, sizesByColor, colorImages } = req.body as {
            colors?: string[];
            sizesByColor?: Record<string, string[]>;
            colorImages?: Record<string, string>;
        };
        const colorList = Array.isArray(colors) ? colors.map((c) => String(c).trim()).filter(Boolean) : [];
        if (colorList.length === 0) return res.status(400).json({ error: 'colors array is required' });

        const parent = await prisma.gmArticleData.findUnique({ where: { id: genericId } });
        if (!parent) return res.status(404).json({ error: 'GM article not found' });

        const allowed = await ApproverController.gmSizesForMajCat(parent.majorCategory || '');
        if (allowed.length === 0) {
            return res.status(422).json({
                error: 'NO_SIZES_FOR_CATEGORY',
                detail: `No sizes are defined for '${parent.majorCategory ?? ''}' in the GM Size Master.`,
            });
        }
        const allowedByUpper = new Map(allowed.map((s) => [s.toUpperCase(), s]));

        const imageByColor: Record<string, string> = {};
        for (const [k, v] of Object.entries(colorImages ?? {})) {
            if (typeof v === 'string' && v.trim()) imageByColor[k.trim().toUpperCase()] = v.trim();
        }
        const missingImg = colorList.filter((c) => !imageByColor[c.toUpperCase()]);
        if (missingImg.length > 0) {
            return res.status(422).json({ error: 'IMAGE_REQUIRED', detail: `An image is required for each color. Missing: ${missingImg.join(', ')}.` });
        }

        // Per-color sizes (default: every allowed size); reject unknown sizes.
        const plan: { color: string; sizes: string[] }[] = [];
        const invalid = new Set<string>();
        for (const color of colorList) {
            const requested = sizesByColor?.[color] ?? sizesByColor?.[color.toUpperCase()];
            const list = Array.isArray(requested) && requested.length > 0 ? requested : allowed;
            const sizes: string[] = [];
            for (const raw of list) {
                const s = allowedByUpper.get(String(raw).trim().toUpperCase());
                if (s) sizes.push(s);
                else invalid.add(String(raw).trim());
            }
            plan.push({ color, sizes: [...new Set(sizes)] });
        }
        if (invalid.size > 0) {
            return res.status(422).json({
                error: 'INVALID_SIZE_FOR_CATEGORY',
                detail: `Size(s) not allowed for '${parent.majorCategory ?? ''}': ${[...invalid].join(', ')}.`,
            });
        }

        const existing = await prisma.gmVariantArticleData.findMany({
            where: { genericArticleId: genericId },
            select: { variantColor: true, variantSize: true },
        });
        const existingPairs = new Set(
            existing.map((e) => `${(e.variantSize ?? '').toUpperCase()}||${(e.variantColor ?? '').toUpperCase()}`),
        );

        const toCreate = plan.flatMap(({ color, sizes }) =>
            sizes
                .filter((size) => !existingPairs.has(`${size.toUpperCase()}||${color.toUpperCase()}`))
                .map((size) => ({ color, size })),
        );
        if (toCreate.length === 0) return res.status(409).json({ error: 'All selected size × color variants already exist' });

        const rows = await prisma.$transaction(
            toCreate.map(({ color, size }) =>
                prisma.gmVariantArticleData.create({
                    data: {
                        genericArticleId:     genericId,
                        genericArticleNumber: parent.gmArticleNumber ?? null,
                        variantColor:         color,
                        variantSize:          size,
                        division:             parent.division ?? null,
                        subDivision:          parent.subDivision ?? null,
                        majorCategory:        parent.majorCategory ?? null,
                        mcDescription:        parent.mcDescription ?? null,
                        vendorName:           parent.vendorName ?? null,
                        vendorCode:           parent.vendorCode ?? null,
                        designNumber:         parent.designNumber ?? null,
                        mrp:                  parent.mrp ?? null,
                        rate:                 parent.rate ?? null,
                        imageUrl:             imageByColor[color.toUpperCase()] ?? parent.imageUrl ?? null,
                        userName:             parent.userName ?? null,
                    },
                }),
            ),
        );
        return res.status(201).json({ count: rows.length, created: rows.map((r) => ApproverController.gmVariantRowToItem(r)) });
    };

    // DELETE /api/approver/gm-article-variant/:id — not allowed once approved.
    static deleteGmArticleVariant = async (req: Request, res: Response) => {
        const existing = await prisma.gmVariantArticleData.findUnique({ where: { id: req.params.id } });
        if (!existing) return res.status(404).json({ error: 'Variant not found' });
        if (existing.approvalStatus === 'APPROVED') return res.status(403).json({ error: 'Cannot delete an approved variant' });
        await prisma.gmVariantArticleData.delete({ where: { id: req.params.id } });
        return res.json({ success: true });
    };

    // Returns ordered description format rows for a given GM major category.
    // maj_cat_nm (e.g. "ST_STATIONARY_SET") is resolved to its archetype_nm
    // ("Stationery") via gm_major_category_details before querying the format table.
    static getGmDescriptionFormat = async (req: Request, res: Response) => {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json({ format: [] });

        // Resolve maj_cat_nm → archetype_nm.
        // Use $queryRawUnsafe to avoid pgbouncer parameter-type inference issues;
        // inputs are sanitized to alphanumeric + safe punctuation before interpolation.
        const safeMajCat = majorCategory.replace(/'/g, "''");
        const archetypeRows = await prisma.$queryRawUnsafe<{ archetype_nm: string }[]>(
            `SELECT DISTINCT archetype_nm
             FROM public.gm_major_category_details
             WHERE LOWER(maj_cat_nm) = LOWER('${safeMajCat}')
             LIMIT 1`,
        );
        const archetypeNm = archetypeRows[0]?.archetype_nm ?? majorCategory;
        const safeArchetype = archetypeNm.replace(/'/g, "''");

        const rows = await prisma.$queryRawUnsafe<{ family_code: string; family_name: string; desc_seq: string }[]>(
            `SELECT family_code, family_name, desc_seq
             FROM public.gm_article_description_formate
             WHERE LOWER(archetype_nm) = LOWER('${safeArchetype}')
               AND desc_seq <> '-'
             ORDER BY CAST(desc_seq AS INTEGER)`,
        );

        return res.json({
            format: rows.map(r => ({
                familyCode: r.family_code,
                familyName: r.family_name,
                descSeq:    r.desc_seq,
            })),
        });
    };

    // Allowed client-side keys → Prisma field names for gm_article_data updates
    private static GM_ARTICLE_UPDATE_FIELDS: Record<string, string> = {
        division: 'division', subDivision: 'subDivision', majorCategory: 'majorCategory',
        mcDescription: 'mcDescription', vendorName: 'vendorName', vendorCode: 'vendorCode',
        designNumber: 'designNumber', pptNumber: 'pptNumber',
        mrp: 'mrp', rate: 'rate', segment: 'segment', articleFashionType: 'articleFashionType',
        imageUrl: 'imageUrl', source: 'source', userName: 'userName',
        gmArticleNumber: 'gmArticleNumber', gmArticleDescription: 'gmArticleDescription',
        fabricArticleDescription: 'gmArticleDescription',  // frontend field alias
        // All 79 GM attribute fields — client sends uppercase family_code, maps to Prisma camelCase
        GM_AGE_GRADE: 'gmAgeGrade', GM_APPLICATOR: 'gmApplicator', GM_BASE_TYPE: 'gmBaseType',
        GM_BATTERY_TYPE: 'gmBatteryType', GM_BPA_FREE: 'gmBpaFree', GM_BPC_FORM: 'gmBpcForm',
        GM_BRAND: 'gmBrand', GM_BRAND_TYPE: 'gmBrandType', GM_CAPACITY_ML: 'gmCapacityMl',
        GM_CARE_INSTRUCTION: 'gmCareInstruction', GM_CERTIFICATION: 'gmCertification',
        GM_CLOSURE_TYPE: 'gmClosureType', GM_COATING: 'gmCoating', GM_COLOUR_FAMILY: 'gmColourFamily',
        GM_COLOUR_SHADE: 'gmColourShade', GM_COMPARTMENT_COUNT: 'gmCompartmentCount',
        GM_COMPOSITION: 'gmComposition', GM_COSMETIC_FINISH: 'gmCosmeticFinish',
        GM_DIAMETER_CM: 'gmDiameterCm', GM_DIM_STANDARD: 'gmDimStandard',
        GM_DISHWASHER_SAFE: 'gmDishwasherSafe', GM_FOLDABLE: 'gmFoldable',
        GM_FOOD_CONTACT_SAFE: 'gmFoodContactSafe', GM_FRAGRANCE_CONC: 'gmFragranceConc',
        GM_FRAGRANCE_FAMILY: 'gmFragranceFamily', GM_FREE_FROM: 'gmFreeFrom',
        GM_FW_HEEL_HT_CM: 'gmFwHeelHtCm', GM_FW_HEEL_TYPE: 'gmFwHeelType', GM_FW_SIZE: 'gmFwSize',
        GM_FW_SOLE: 'gmFwSole', GM_FW_TOE: 'gmFwToe', GM_FW_UPPER: 'gmFwUpper',
        GM_GSM: 'gmGsm', GM_HEAT_RETENTION_HR: 'gmHeatRetentionHr', GM_HEIGHT_CM: 'gmHeightCm',
        GM_INSULATION_TYPE: 'gmInsulationType', GM_KEY_INGREDIENT: 'gmKeyIngredient',
        GM_LEAK_PROOF: 'gmLeakProof', GM_LENGTH_CM: 'gmLengthCm', GM_LICENCE: 'gmLicence',
        GM_LID_TYPE: 'gmLidType', GM_LIFESTAGE: 'gmLifestage', GM_LINING_MATERIAL: 'gmLiningMaterial',
        GM_MANUFACTURER: 'gmManufacturer', GM_MATERIAL: 'gmMaterial',
        GM_MATERIAL_GROUP: 'gmMaterialGroup', GM_MATERIAL_SECONDARY: 'gmMaterialSecondary',
        GM_MICROWAVE_SAFE: 'gmMicrowaveSafe', GM_MOUNT_TYPE: 'gmMountType',
        GM_NET_CONTENT: 'gmNetContent', GM_NET_CONTENT_UOM: 'gmNetContentUom',
        GM_NET_WEIGHT_G: 'gmNetWeightG', GM_PACK_QTY: 'gmPackQty', GM_PATTERN: 'gmPattern',
        GM_PLAY_PATTERN: 'gmPlayPattern', GM_PLAYER_COUNT: 'gmPlayerCount',
        GM_POWER_SOURCE: 'gmPowerSource', GM_PRICE_TIER: 'gmPriceTier',
        GM_PRINT_THEME: 'gmPrintTheme', GM_SEASON: 'gmSeason', GM_SELL_UOM: 'gmSellUom',
        GM_SET_CONTENTS: 'gmSetContents', GM_SHELF_LIFE_MONTHS: 'gmShelfLifeMonths',
        GM_SKIN_TYPE: 'gmSkinType', GM_SPF: 'gmSpf', GM_SPORT: 'gmSport',
        GM_STRAP_TYPE: 'gmStrapType', GM_SURFACE_FINISH: 'gmSurfaceFinish',
        GM_TEXTILE_FABRIC: 'gmTextileFabric', GM_THREAD_COUNT: 'gmThreadCount',
        GM_USAGE_OCCASION: 'gmUsageOccasion', GM_VOLTAGE_V: 'gmVoltageV',
        GM_WARRANTY_MONTHS: 'gmWarrantyMonths', GM_WATTAGE_W: 'gmWattageW',
        GM_WEAVE: 'gmWeave', GM_WHEEL_COUNT: 'gmWheelCount', GM_WIDTH_CM: 'gmWidthCm',
        GM_YARN: 'gmYarn',
    };

    static rejectGmArticles = async (req: Request, res: Response) => {
        const { ids } = req.body as { ids?: string[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'No items selected' });
        }
        const result = await prisma.gmArticleData.updateMany({
            where: { id: { in: ids } },
            data: {
                approvalStatus: 'REJECTED',
                sapSyncStatus: 'NOT_SYNCED',
                sapSyncMessage: 'Rejected by approver',
                approvedAt: new Date(),
            },
        });
        return res.json({ success: true, rejected: result.count });
    };

    static updateGmArticleData = async (req: Request, res: Response) => {
        const { id } = req.params;
        const body = req.body as Record<string, unknown>;

        const existing = await prisma.gmArticleData.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Item not found' });

        if (existing.approvalStatus === 'APPROVED') {
            return res.status(403).json({ error: 'Cannot update an approved GM article. It is locked.' });
        }

        const data: Record<string, unknown> = {};
        for (const [clientKey, value] of Object.entries(body)) {
            const dbKey = ApproverController.GM_ARTICLE_UPDATE_FIELDS[clientKey];
            if (dbKey) data[dbKey] = value === undefined ? null : value;
        }
        if (Object.keys(data).length === 0) {
            return res.json(ApproverController.gmArticleDataRowToItem(existing));
        }
        const row = await prisma.gmArticleData.update({ where: { id }, data });
        return res.json(ApproverController.gmArticleDataRowToItem(row));
    };

    static async searchFabricArticleData(req: Request, res: Response) {
        const q = String(req.query.q ?? '').trim();
        if (!q) return res.json({ results: [], attributeFallbackRate: null });

        const descResults = await prisma.preciseFabricArticleData.findMany({
            where: {
                OR: [
                    { fabricArticleDescription: { contains: q, mode: 'insensitive' } },
                    ...(isNaN(Number(q)) ? [] : [{ fabricArticleNumber: { equals: BigInt(q) } }]),
                ],
            },
            select: {
                fabricArticleNumber: true,
                fabricArticleDescription: true,
                fabricRate: true,
                mFabDiv: true,
                mYarn: true,
                mFabMainMvgr1: true,
                mFabMainMvgr2: true,
                mConstruction: true,
                mOunz: true,
                mWidth: true,
                mWeave01: true,
                mWeave02: true,
                mCount: true,
                mComposition: true,
                mFinish: true,
                mGsm: true,
                mLycra: true,
            },
            take: 15,
            orderBy: { fabricArticleNumber: 'asc' },
        });

        const results = descResults.map((r) => ({
            ...r,
            fabricArticleNumber: r.fabricArticleNumber ? String(r.fabricArticleNumber) : null,
            fabricRate: r.fabricRate ? Number(r.fabricRate) : null,
        }));

        if (results.length > 0) return res.json({ results, attributeFallbackRate: null });

        // Attribute-based fallback — exact match on 8 fabric attributes
        const mFabDiv      = String(req.query.mFabDiv      ?? '').trim() || undefined;
        const mYarn        = String(req.query.mYarn        ?? '').trim() || undefined;
        const mFabMainMvgr1 = String(req.query.mFabMainMvgr1 ?? '').trim() || undefined;
        const mConstruction = String(req.query.mConstruction ?? '').trim() || undefined;
        const mWidth       = String(req.query.mWidth       ?? '').trim() || undefined;
        const mWeave01     = String(req.query.mWeave01     ?? '').trim() || undefined;
        const mComposition = String(req.query.mComposition ?? '').trim() || undefined;
        const mLycra       = String(req.query.mLycra       ?? '').trim() || undefined;

        const attrWhere: Record<string, unknown> = {};
        if (mFabDiv)       attrWhere.mFabDiv       = mFabDiv;
        if (mYarn)         attrWhere.mYarn          = mYarn;
        if (mFabMainMvgr1) attrWhere.mFabMainMvgr1  = mFabMainMvgr1;
        if (mConstruction) attrWhere.mConstruction  = mConstruction;
        if (mWidth)        attrWhere.mWidth         = mWidth;
        if (mWeave01)      attrWhere.mWeave01       = mWeave01;
        if (mComposition)  attrWhere.mComposition   = mComposition;
        if (mLycra)        attrWhere.mLycra         = mLycra;

        let attributeFallbackRate: number | null = null;
        if (Object.keys(attrWhere).length > 0) {
            const attrMatches = await prisma.preciseFabricArticleData.findMany({
                where: attrWhere,
                select: { fabricRate: true },
                orderBy: { fabricRate: 'asc' },
                take: 1,
            });
            if (attrMatches.length > 0 && attrMatches[0].fabricRate != null) {
                attributeFallbackRate = Number(attrMatches[0].fabricRate);
            }
        }

        return res.json({ results: [], attributeFallbackRate });
    }

    // Rough-V2 rate lookup — exact match on 5 fabric attributes in precise_fabric_article_data,
    // returns the lowest fabric_rate among matches (or null if no match).
    static async getRoughV2Rate(req: Request, res: Response) {
        const mYarn        = String(req.query.mYarn        ?? '').trim() || undefined;
        const mFabDiv      = String(req.query.mFabDiv      ?? '').trim() || undefined;
        const mFabMainMvgr1 = String(req.query.mFabMainMvgr1 ?? '').trim() || undefined;
        const mWeave01     = String(req.query.mWeave01     ?? '').trim() || undefined;
        const mLycra       = String(req.query.mLycra       ?? '').trim() || undefined;

        const where: Record<string, unknown> = {};
        if (mYarn)         where.mYarn         = mYarn;
        if (mFabDiv)       where.mFabDiv       = mFabDiv;
        if (mFabMainMvgr1) where.mFabMainMvgr1 = mFabMainMvgr1;
        if (mWeave01)      where.mWeave01      = mWeave01;
        if (mLycra)        where.mLycra        = mLycra;

        if (Object.keys(where).length === 0) return res.json({ rate: null });

        const match = await prisma.preciseFabricArticleData.findFirst({
            where,
            select: { fabricRate: true },
            orderBy: { fabricRate: 'asc' },
        });

        const rate = match?.fabricRate != null ? Number(match.fabricRate) : null;
        return res.json({ rate });
    }

    // Body Article No. search (Body & Construction card) — backed by body_article_data,
    // the admin-managed master table (see Admin.tsx "Body Article Data" upload card).
    // Partial queries return up to 10 matches; an exact Body Article Number match (if any)
    // is always included, even if it would otherwise fall outside the top 10.
    // Scoped to the current article's major category when ?majorCategory= is passed — the
    // detail page already knows it (shown in "Category" under Article Information), so results
    // never leak body articles belonging to a different major category.
    static async searchBodyArticleData(req: Request, res: Response) {
        const q = String(req.query.q ?? '').trim();
        if (!q) return res.json({ results: [] });
        const majorCategory = String(req.query.majorCategory ?? '').trim();

        type BodyRow = {
            body_article_number: string | null;
            body_article_description: string | null;
            m_collar_type: string | null; m_collar_style: string | null;
            m_neck_type: string | null; m_neck_style: string | null;
            m_placket: string | null; m_blt_type: string | null; m_blt_style: string | null;
            m_sleeves_main_style: string | null; m_sleeve_fold: string | null; m_btm_fold: string | null;
            m_no_of_pocket: string | null; m_pocket: string | null; m_extra_pocket: string | null;
            m_fit: string | null; m_body_style: string | null; m_length: string | null; m_set: string | null;
            cmtp_cost: string | null; cmp_cost: string | null; fab_cons: string | null; width: string | null;
        };

        const mcFilter = majorCategory
            ? Prisma.sql`AND TRIM(LOWER(b.major_category)) = TRIM(LOWER(${majorCategory}))`
            : Prisma.empty;

        const rows = await prisma.$queryRaw<BodyRow[]>`
            SELECT DISTINCT ON (b.body_article_number)
                b.body_article_number,
                b.body_article_description,
                b.m_collar_type, b.m_collar_style,
                b.m_neck_type, b.m_neck_style,
                b.m_placket, b.m_blt_type, b.m_blt_style,
                b.m_sleeves_main_style, b.m_sleeve_fold, b.m_btm_fold,
                b.m_no_of_pocket, b.m_pocket, b.m_extra_pocket,
                b.m_fit, b.m_body_style, b.m_length, b.m_set,
                b.cmtp_cost::text, b.cmp_cost::text, b.fab_cons::text, b.width::text
            FROM body_article_data b
            WHERE b.body_article_number IS NOT NULL
              AND TRIM(b.body_article_number) <> ''
              AND (
                LOWER(b.body_article_number) LIKE LOWER(${'%' + q + '%'})
                OR LOWER(COALESCE(b.body_article_description, '')) LIKE LOWER(${'%' + q + '%'})
              )
              ${mcFilter}
            ORDER BY b.body_article_number
            LIMIT 10
        `;

        const results = rows.map((r) => ({
            bodyArticleNumber:      r.body_article_number,
            bodyArticleDescription: r.body_article_description,
            mCollarType:  r.m_collar_type,  mCollarStyle: r.m_collar_style,
            mNeckType:    r.m_neck_type,    mNeckStyle:   r.m_neck_style,
            mPlacket:     r.m_placket,      mBltType:     r.m_blt_type,     mBltStyle: r.m_blt_style,
            mSleevesMainStyle: r.m_sleeves_main_style, mSleeveFold: r.m_sleeve_fold, mBtmFold: r.m_btm_fold,
            mNoOfPocket:  r.m_no_of_pocket, mPocket:      r.m_pocket,       mExtraPocket: r.m_extra_pocket,
            mFit:         r.m_fit,          mBodyStyle:   r.m_body_style,   mLength: r.m_length, mSet: r.m_set,
            width:        r.width      != null ? Number(r.width)      : null,
        }));

        return res.json({ results });
    }

    // Returns the fabric consumption for a given major category + fabric width from
    // precise_body_article_consumption. Width columns are named width15, width66, etc.
    // If no exact column match, falls back to the minimum non-null value across all width columns.
    static getPreciseConsumptionByWidth = async (req: Request, res: Response) => {
        const majorCategory          = String(req.query.majorCategory          ?? '').trim();
        const fabWidthRaw            = String(req.query.fabWidth               ?? '').trim().replace(/"/g, '');
        const microBodyArticleNumber = String(req.query.microBodyArticleNumber ?? '').trim();
        if (!majorCategory || !fabWidthRaw) return res.json({ consumption: null });
        const fabWidthNum = Math.round(parseFloat(fabWidthRaw));
        if (isNaN(fabWidthNum)) return res.json({ consumption: null });

        const where: Record<string, unknown> = {
            majorCategory: { equals: majorCategory, mode: 'insensitive' },
        };
        if (microBodyArticleNumber) {
            where['microBodyArticleNumber'] = { equals: microBodyArticleNumber, mode: 'insensitive' };
        }
        const row = await prisma.preciseBodyArticleConsumption.findFirst({ where } as any);
        if (!row) return res.json({ consumption: null });

        // Try exact width column first (e.g. width66)
        const exactKey = `width${fabWidthNum}` as keyof typeof row;
        const exactVal = row[exactKey];
        if (exactVal != null) return res.json({ consumption: Number(exactVal) });

        // Fallback: minimum non-null value across all width columns
        const WIDTH_KEYS: (keyof typeof row)[] = [
            'width15','width16','width17','width18','width19',
            'width42','width43','width44','width46','width48','width50',
            'width53','width54','width55','width56','width57','width58','width59','width60',
            'width61','width62','width63','width64','width65','width66','width67','width68',
            'width69','width70','width71','width72','width73','width74','width76','width78',
            'width82','width92','width94','width96',
        ];
        let minVal: number | null = null;
        for (const k of WIDTH_KEYS) {
            const v = row[k];
            if (v != null) {
                const n = Number(v);
                if (minVal === null || n < minVal) minVal = n;
            }
        }
        return res.json({ consumption: minVal });
    };

    // basic_trim_master lookup — returns bt_1 / bt_2 for a given attribute_name + type combination.
    // Used by the B TRIM card to auto-fill AUTO-BGT and ROUGH-V2 when a spec value is selected.
    // Without `type`, returns every type for the attribute in one call: { found, rows: [{ type, bt1, bt2 }] }
    // (used for the OTHER ACC rows, attribute "OTHER BASIC TRIM").
    static getBasicTrimMasterLookup = async (req: Request, res: Response) => {
        const attributeName = String(req.query.attributeName ?? '').trim();
        const type          = String(req.query.type          ?? '').trim();
        if (attributeName && !type) {
            const rows = await prisma.$queryRaw<{ type: string; bt_1: string | null; bt_2: string | null }[]>`
                SELECT type, bt_1, bt_2
                FROM basic_trim_master
                WHERE TRIM(LOWER(attribute_name)) = TRIM(LOWER(${attributeName}))
                ORDER BY type
            `;
            return res.json({
                found: rows.length > 0,
                rows: rows.map((r) => ({
                    type: r.type,
                    bt1: r.bt_1 != null ? Number(r.bt_1) : null,
                    bt2: r.bt_2 != null ? Number(r.bt_2) : null,
                })),
            });
        }
        if (!attributeName || !type) return res.json({ found: false, bt1: null, bt2: null });

        const row = await prisma.$queryRaw<{ bt_1: string | null; bt_2: string | null }[]>`
            SELECT bt_1, bt_2
            FROM basic_trim_master
            WHERE TRIM(LOWER(attribute_name)) = TRIM(LOWER(${attributeName}))
              AND TRIM(LOWER(type))           = TRIM(LOWER(${type}))
            LIMIT 1
        `;

        if (!row.length) return res.json({ found: false, bt1: null, bt2: null });
        return res.json({
            found: true,
            bt1: row[0].bt_1 != null ? Number(row[0].bt_1) : null,
            bt2: row[0].bt_2 != null ? Number(row[0].bt_2) : null,
        });
    };

    // CMP cost data for a body article — returns SAM/cost fields from precise_body_article_consumption
    // by microBodyArticleNumber for use in the CMP COST card ACT column auto-fill.
    static getPreciseBodyArticleCmpData = async (req: Request, res: Response) => {
        const microBodyArticleNumber = String(req.query.microBodyArticleNumber ?? '').trim();
        if (!microBodyArticleNumber) return res.status(400).json({ error: 'microBodyArticleNumber required' });

        const row = await prisma.preciseBodyArticleConsumption.findFirst({
            where: { microBodyArticleNumber: { equals: microBodyArticleNumber, mode: 'insensitive' } } as any,
            select: { cuttingValue: true, stitchingSam: true, samVal: true, ironingSam: true, finishingSam: true },
        });

        if (!row) return res.json({ found: false });

        return res.json({
            found: true,
            cuttingValue:  row.cuttingValue  != null ? Number(row.cuttingValue)  : null,
            stitchingSam:  row.stitchingSam  != null ? Number(row.stitchingSam)  : null,
            samVal:        row.samVal        != null ? Number(row.samVal)        : null,
            ironingSam:    row.ironingSam    != null ? Number(row.ironingSam)    : null,
            finishingSam:  row.finishingSam  != null ? Number(row.finishingSam)  : null,
        });
    };

    // Smart body article search — filters precise_body_article_consumption by major category
    // and active grid attributes from body_article_description_formate, returns matching rows.
    static async searchPreciseBodyArticle(req: Request, res: Response) {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json({ results: [] });

        const ATTR_COLS = [
            'm_neck_type', 'm_neck_style', 'm_collar_type', 'm_collar_style',
            'm_placket', 'm_blt_type', 'm_blt_style',
            'm_sleeves_main_style', 'm_sleeve_fold', 'm_btm_fold',
            'm_pocket', 'm_no_of_pocket', 'm_extra_pocket',
            'm_fit', 'body_style', 'm_length',
        ];

        const activeRows = await prisma.$queryRaw<{ attributes_maj_cat: string }[]>`
            SELECT attributes_maj_cat FROM body_article_description_formate
            WHERE TRIM(LOWER(fg_maj_cat)) = TRIM(LOWER(${majorCategory}))
              AND fr_grid_status = 'ACT'
        `;
        const activeAttrs = new Set(activeRows.map((r) => r.attributes_maj_cat.toLowerCase().trim()));

        // Optional text filter on article number (used by NO. field smart search)
        const q = String(req.query.q ?? '').trim();

        let sql = `SELECT DISTINCT ON (micro_body_article_number) macro_body_description, micro_body_article_number
                   FROM precise_body_article_consumption
                   WHERE TRIM(LOWER(major_category)) = TRIM(LOWER($1))`;
        const params: (string)[] = [majorCategory];
        let idx = 2;

        if (q) {
            sql += ` AND LOWER(COALESCE(micro_body_article_number, '')) LIKE LOWER($${idx})`;
            params.push(`%${q}%`);
            idx++;
        }

        for (const col of ATTR_COLS) {
            if (!activeAttrs.has(col)) continue;
            const val = String(req.query[col] ?? '').trim();
            if (!val) continue;
            // '-' = the article has no value for this attribute → match rows where it's empty too.
            if (/^-+$/.test(val)) {
                sql += ` AND TRIM(COALESCE(${col}, '')) IN ('', '-')`;
                continue;
            }
            sql += ` AND TRIM(LOWER(COALESCE(${col}, ''))) = TRIM(LOWER($${idx}))`;
            params.push(val);
            idx++;
        }

        // DISTINCT ON requires the distinct column first in ORDER BY
        sql += ' ORDER BY micro_body_article_number, macro_body_description LIMIT 50';

        const rows = await prisma.$queryRawUnsafe<{
            macro_body_description: string | null;
            micro_body_article_number: string | null;
        }[]>(sql, ...params);

        return res.json({
            results: rows.map((r) => ({
                macroBodyDescription:   r.macro_body_description,
                microBodyArticleNumber: r.micro_body_article_number,
            })),
        });
    }

    static getBodyFabricConsumption = async (req: Request, res: Response) => {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json([]);
        const rows = await prisma.bodyFabricConsumption.findMany({
            where: { majorCategory: { equals: majorCategory, mode: 'insensitive' } },
            select: { fabWidth: true, fabConsumption: true },
            orderBy: { fabWidth: 'asc' },
        });
        return res.json(rows.map((r) => ({
            fabWidth:       r.fabWidth       != null ? Number(r.fabWidth)       : null,
            fabConsumption: r.fabConsumption != null ? Number(r.fabConsumption) : null,
        })));
    };

    // Returns fab_consumption for a specific major_category + fab_width combination.
    // fab_width is matched by rounding the queried value to 2 decimal places.
    static getBodyFabricConsumptionByWidth = async (req: Request, res: Response) => {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        const fabWidthRaw   = String(req.query.fabWidth   ?? '').trim().replace(/"/g, '');
        if (!majorCategory || !fabWidthRaw) return res.json({ fabConsumption: null });
        const fabWidthNum = parseFloat(fabWidthRaw);
        if (isNaN(fabWidthNum)) return res.json({ fabConsumption: null });
        const row = await prisma.bodyFabricConsumption.findFirst({
            where: {
                majorCategory: { equals: majorCategory, mode: 'insensitive' },
                fabWidth:      { equals: fabWidthNum },
            },
            select: { fabConsumption: true },
        });
        return res.json({ fabConsumption: row?.fabConsumption != null ? Number(row.fabConsumption) : null });
    };

    // Returns GSM for a major category from body_fabric_consumption (gsm is
    // stored once per major category, duplicated across its fab_width rows —
    // any non-null match is the value). Used to auto-fill Fabric Article
    // Data's GSM field on the New FG Article page.
    static getFabricGsmByMajorCategory = async (req: Request, res: Response) => {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json({ gsm: null });
        const row = await prisma.bodyFabricConsumption.findFirst({
            where: { majorCategory: { equals: majorCategory, mode: 'insensitive' }, gsm: { not: null } },
            select: { gsm: true },
        });
        return res.json({ gsm: row?.gsm != null ? Number(row.gsm) : null });
    };

    // Returns cmp_cost for a major category from rough_cmp_cost_master
    static getRoughCmpCost = async (req: Request, res: Response) => {
        const majorCategory = String(req.query.majorCategory ?? '').trim();
        if (!majorCategory) return res.json({ cmpCost: null });
        const row = await prisma.roughCmpCostMaster.findFirst({
            where: { majCat: { equals: majorCategory, mode: 'insensitive' } },
            select: {
                cmpCost: true,
                cuttingSam: true, cuttingVal: true,
                stitchingSam: true, stitchingVal: true,
                ironingSam: true, ironingVal: true,
                finishingSam: true, finishingVal: true,
            },
        });
        if (!row) return res.json({ cmpCost: null });
        const n = (v: any) => (v != null ? Number(v) : null);
        return res.json({
            cmpCost:      n(row.cmpCost),
            cuttingSam:   n(row.cuttingSam),
            cuttingVal:   n(row.cuttingVal),
            stitchingSam: n(row.stitchingSam),
            stitchingVal: n(row.stitchingVal),
            ironingSam:   n(row.ironingSam),
            ironingVal:   n(row.ironingVal),
            finishingSam: n(row.finishingSam),
            finishingVal: n(row.finishingVal),
        });
    };

    static getBodyArticleItems = async (req: Request, res: Response) => {
        const {
            page = '1', limit = '50',
            status, division, subDivision, majorCategory,
            search, startDate, endDate, groupBy,
        } = req.query as Record<string, string>;

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const take = parseInt(limit, 10);

        const where: any = { bodyArticleType: 'FG' };

        // BODY_APPROVER only sees articles the creator has confirmed (fg_creator_approved = 'APPROVED')
        const requestingUserRole = (req as any).user?.role as string | undefined;
        if (requestingUserRole === 'BODY_APPROVER') {
            where.fgCreatorApproved = 'APPROVED';
        }

        if (status && status !== 'ALL') {
            const statuses = status.split(',').map((s: string) => s.trim()).filter(Boolean);
            where.approvalStatus = statuses.length === 1 ? statuses[0] : { in: statuses };
        }
        if (division && division !== 'ALL') where.division = { contains: division, mode: 'insensitive' };
        if (subDivision && subDivision !== 'ALL') where.subDivision = { equals: subDivision, mode: 'insensitive' };
        if (majorCategory) where.majorCategory = { equals: majorCategory, mode: 'insensitive' };
        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) where.createdAt.gte = new Date(startDate);
            if (endDate)   where.createdAt.lte = new Date(endDate);
        }
        if (search) {
            where.OR = [
                { articleNumber:          { contains: search, mode: 'insensitive' } },
                { designNumber:           { contains: search, mode: 'insensitive' } },
                { bodyArticleNumber:      { contains: search, mode: 'insensitive' } },
                { bodyArticleDescription: { contains: search, mode: 'insensitive' } },
                { vendorName:             { contains: search, mode: 'insensitive' } },
                { vendorCode:             { contains: search, mode: 'insensitive' } },
                { majorCategory:          { contains: search, mode: 'insensitive' } },
            ];
        }

        const select = {
                id: true, articleNumber: true, division: true, subDivision: true,
                majorCategory: true, mcCode: true, vendorName: true, vendorCode: true,
                designNumber: true,
                season: true, year: true, hsnTaxCode: true, imageUrl: true,
                approvalStatus: true, fgCreatorApproved: true, approvedAt: true, approvedBy: true,
                sapSyncStatus: true, sapSyncMessage: true,
                userName: true, createdAt: true, updatedAt: true,
                bodyArticleType: true,
                mCollarType: true, mCollarStyle: true, mNeckType: true, mNeckStyle: true,
                mPlacket: true, mBltType: true, mBltStyle: true,
                mSleevesMainStyle: true, mSleeveFold: true, mBtmFold: true,
                mNoOfPocket: true, mPocket: true, mExtraPocket: true,
                mFit: true, mBodyStyle: true, mLength: true, mSet: true,
                bodyArticleNumber: true, bodyArticleDescription: true,
                width: true, roughCmpCost: true,
                bodyConsumptionType: true, gsm: true, ratio: true, consumptionKg: true, consumptionMeter: true,
                preciseWidth: true, preciseGsm: true, preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
        };
        const { rows, total } = ApproverController.isCardGroupBy(groupBy)
            ? await ApproverController.findGroupedPage(prisma.bodyArticleData, { where, select, skip, take, groupBy, dateField: 'createdAt' })
            : await Promise.all([
                prisma.bodyArticleData.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select }),
                prisma.bodyArticleData.count({ where }),
            ]).then(([rows, total]) => ({ rows, total }));

        const data = rows.map((r) => ({
            id:                       r.id,
            imageName:                null,
            imageUrl:                 r.imageUrl ?? null,
            articleNumber:            r.articleNumber ?? null,
            division:                 r.division ?? null,
            subDivision:              r.subDivision ?? null,
            majorCategory:            r.majorCategory ?? null,
            mcCode:                   r.mcCode ?? null,
            vendorName:               r.vendorName ?? null,
            vendorCode:               r.vendorCode ?? null,
            season:                   r.season ?? null,
            year:                     r.year ?? null,
            hsnTaxCode:               r.hsnTaxCode ?? null,
            approvalStatus:           r.approvalStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
            fgCreatorApproved:        r.fgCreatorApproved ?? 'PENDING',
            approvedAt:               r.approvedAt?.toISOString() ?? null,
            sapSyncStatus:            (r.sapSyncStatus ?? 'NOT_SYNCED') as any,
            sapSyncMessage:           r.sapSyncMessage ?? null,
            sapArticleId:             null,
            userName:                 r.userName ?? null,
            createdAt:                r.createdAt.toISOString(),
            updatedAt:                r.updatedAt.toISOString(),
            bodyArticleType:          r.bodyArticleType ?? null,
            // Body & Construction fields
            collar:                   r.mCollarType ?? null,
            collarStyle:              r.mCollarStyle ?? null,
            neck:                     r.mNeckType ?? null,
            neckDetails:              r.mNeckStyle ?? null,
            placket:                  r.mPlacket ?? null,
            fatherBelt:               r.mBltType ?? null,
            childBelt:                r.mBltStyle ?? null,
            sleeve:                   r.mSleevesMainStyle ?? null,
            sleeveFold:               r.mSleeveFold ?? null,
            bottomFold:               r.mBtmFold ?? null,
            noOfPocket:               r.mNoOfPocket ?? null,
            pocketType:               r.mPocket ?? null,
            extraPocket:              r.mExtraPocket ?? null,
            fit:                      r.mFit ?? null,
            pattern:                  r.mBodyStyle ?? null,
            length:                   r.mLength ?? null,
            mSet:                     r.mSet ?? null,
            bodyArticle:              r.bodyArticleNumber ?? null,
            bodyArticleDescription:   r.bodyArticleDescription ?? null,
            designNumber:             r.designNumber ?? null,
            bodyWidth:                r.width    != null ? Number(r.width)    : null,
            roughCmpCost:             r.roughCmpCost     != null ? Number(r.roughCmpCost)     : null,
            bodyConsumptionType:      r.bodyConsumptionType ?? null,
            gsm:                      r.gsm              != null ? Number(r.gsm)              : null,
            ratio:                    r.ratio            != null ? Number(r.ratio)            : null,
            consumptionKg:            r.consumptionKg    != null ? Number(r.consumptionKg)    : null,
            consumptionMeter:         r.consumptionMeter    != null ? Number(r.consumptionMeter)    : null,
            preciseWidth:             r.preciseWidth        != null ? Number(r.preciseWidth)        : null,
            preciseGsm:               r.preciseGsm          != null ? Number(r.preciseGsm)          : null,
            preciseRatio:             r.preciseRatio        != null ? Number(r.preciseRatio)        : null,
            preciseConsumptionKg:     r.preciseConsumptionKg    != null ? Number(r.preciseConsumptionKg)    : null,
            preciseConsumptionMeter:  r.preciseConsumptionMeter != null ? Number(r.preciseConsumptionMeter) : null,
            // Fields not in body_article_data — nulled out
            cuttingBgtPrVal: null, cuttingActPrVal: null, cuttingVendorPrVal: null, cuttingFinalPrVal: null,
            stitchingBgtPrVal: null, stitchingActPrVal: null, stitchingVendorPrVal: null, stitchingFinalPrVal: null,
            ironingBgtPrVal: null, ironingActPrVal: null, ironingVendorPrVal: null, ironingFinalPrVal: null,
            finishingBgtPrVal: null, finishingActPrVal: null, finishingVendorPrVal: null, finishingFinalPrVal: null, totalBgtPrVal: null, totalActPrVal: null, totalVendorPrVal: null, totalFinalPrVal: null,
            bTrimType: null,
            mBtnAutoBgt: null, mBtnRoughV2: null, mBtnVdrCost: null, mBtnFinalCost: null, bTrimTotalAutoBgt: null, bTrimTotalRoughV2: null, bTrimTotalVdrCost: null, bTrimTotalFinalCost: null,
            dcAutoBgt: null, dcRoughV2: null, dcVdrCost: null, dcFinalCost: null,
            zipAutoBgt: null, zipRoughV2: null, zipVdrCost: null, zipFinalCost: null,
            patchAutoBgt: null, patchRoughV2: null, patchVdrCost: null, patchFinalCost: null,
            hTrfAutoBgt: null, hTrfRoughV2: null, hTrfVdrCost: null, hTrfFinalCost: null,
            elasticAutoBgt: null, elasticRoughV2: null, elasticVdrCost: null, elasticFinalCost: null,
            fusingAutoBgt: null, fusingRoughV2: null, fusingVdrCost: null, fusingFinalCost: null,
            badgeAutoBgt: null, badgeRoughV2: null, badgeVdrCost: null, badgeFinalCost: null,
            rivetAutoBgt: null, rivetRoughV2: null, rivetVdrCost: null, rivetFinalCost: null,
            tapeAutoBgt: null, tapeRoughV2: null, tapeVdrCost: null, tapeFinalCost: null,
            otherAutoBgt: null, otherRoughV2: null, otherVdrCost: null, otherFinalCost: null,
            adjusterAutoBgt: null, adjusterRoughV2: null, adjusterVdrCost: null, adjusterFinalCost: null,
            brotchAutoBgt: null, brotchRoughV2: null, brotchVdrCost: null, brotchFinalCost: null,
            buckleAutoBgt: null, buckleRoughV2: null, buckleVdrCost: null, buckleFinalCost: null,
            eyeletsAutoBgt: null, eyeletsRoughV2: null, eyeletsVdrCost: null, eyeletsFinalCost: null,
            hangingDRingAutoBgt: null, hangingDRingRoughV2: null, hangingDRingVdrCost: null, hangingDRingFinalCost: null,
            hookAutoBgt: null, hookRoughV2: null, hookVdrCost: null, hookFinalCost: null,
            labelAutoBgt: null, labelRoughV2: null, labelVdrCost: null, labelFinalCost: null,
            laceAutoBgt: null, laceRoughV2: null, laceVdrCost: null, laceFinalCost: null,
            pockettingFabricAutoBgt: null, pockettingFabricRoughV2: null, pockettingFabricVdrCost: null, pockettingFabricFinalCost: null,
            pockettingReadymadeAutoBgt: null, pockettingReadymadeRoughV2: null, pockettingReadymadeVdrCost: null, pockettingReadymadeFinalCost: null,
            santaAutoBgt: null, santaRoughV2: null, santaVdrCost: null, santaFinalCost: null,
            stopperAutoBgt: null, stopperRoughV2: null, stopperVdrCost: null, stopperFinalCost: null,
            tagAutoBgt: null, tagRoughV2: null, tagVdrCost: null, tagFinalCost: null,
            tasselsAutoBgt: null, tasselsRoughV2: null, tasselsVdrCost: null, tasselsFinalCost: null,
            mBtnRate: null, mBtnQty: null, dcRate: null, dcQty: null, zipRate: null, zipQty: null, patchRate: null, patchQty: null, hTrfRate: null, hTrfQty: null, elasticRate: null, elasticQty: null, fusingRate: null, fusingQty: null, badgeRate: null, badgeQty: null, rivetRate: null, rivetQty: null, tapeRate: null, tapeQty: null, otherRate: null, otherQty: null, adjusterRate: null, adjusterQty: null, brotchRate: null, brotchQty: null, buckleRate: null, buckleQty: null, eyeletsRate: null, eyeletsQty: null, hangingDRingRate: null, hangingDRingQty: null, hookRate: null, hookQty: null, labelRate: null, labelQty: null, laceRate: null, laceQty: null, pockettingFabricRate: null, pockettingFabricQty: null, pockettingReadymadeRate: null, pockettingReadymadeQty: null, santaRate: null, santaQty: null, stopperRate: null, stopperQty: null, tagRate: null, tagQty: null, tasselsRate: null, tasselsQty: null,
            printAutoBgt: null, printRoughV2: null, printVendorCost: null, printFinalCost: null,
            embAutoBgt: null, embRoughV2: null, embVendorCost: null, embFinalCost: null,
            washingAutoBgt: null, washingRoughV2: null, washingVendorCost: null, washingFinalCost: null,
            vaddTotalAutoBgt: null, vaddTotalRoughV2: null, vaddTotalVendorCost: null, vaddTotalFinalCost: null,
            pkgCostType: null, boppNetPrice: null, ctnNetPrice: null, barcodeNetPrice: null,
            kimbleNetPrice: null, taftaNetPrice: null, threadNetPrice: null,
            pptNumber: null, source: null, rate: null, mrp: null,
            size: null, colour: null, fabricMainMvgr: null, composition: null,
            wash: null, referenceArticleNumber: null, referenceArticleDescription: null,
            fabricArticleNumber: null, fabricArticleDescription: null, mcDescription: null,
            segment: null, articleDescription: null, fashionGrid: null, articleType: null,
            yarn1: null, yarn2: null, weave: null, macroMvgr: null, mainMvgr: null,
            mFab2: null, finish: null, shade: null, weight: null, lycra: null,
        }));

        return res.json({ data, meta: { total, page: parseInt(page, 10), limit: take } });
    };

    // Map ApproverItem camelCase field names → body_article_data Prisma field names
    private static readonly BODY_FIELD_MAP: Record<string, string> = {
        collar:               'mCollarType',
        collarStyle:          'mCollarStyle',
        neck:                 'mNeckType',
        neckDetails:          'mNeckStyle',
        placket:              'mPlacket',
        fatherBelt:           'mBltType',
        childBelt:            'mBltStyle',
        sleeve:               'mSleevesMainStyle',
        sleeveFold:           'mSleeveFold',
        mSet:                 'mSet',
        bottomFold:           'mBtmFold',
        noOfPocket:           'mNoOfPocket',
        pocketType:           'mPocket',
        extraPocket:          'mExtraPocket',
        fit:                  'mFit',
        pattern:              'mBodyStyle',
        length:               'mLength',
        bodyArticle:          'bodyArticleNumber',
        bodyArticleDescription: 'bodyArticleDescription',
        fWidth:               'width',
        width:                'width',
        roughCmpCost:         'roughCmpCost',
        bodyConsumptionType:     'bodyConsumptionType',
        gsm:                     'gsm',
        ratio:                   'ratio',
        consumptionKg:           'consumptionKg',
        consumptionMeter:        'consumptionMeter',
        preciseWidth:            'preciseWidth',
        preciseGsm:              'preciseGsm',
        preciseRatio:            'preciseRatio',
        preciseConsumptionKg:    'preciseConsumptionKg',
        preciseConsumptionMeter: 'preciseConsumptionMeter',
        vendorCode:           'vendorCode',
        vendorName:           'vendorName',
        majorCategory:        'majorCategory',
        mcCode:               'mcCode',
        division:             'division',
        subDivision:          'subDivision',
        season:               'season',
        year:                 'year',
        hsnTaxCode:           'hsnTaxCode',
        designNumber:         'designNumber',
    };

    private static bodyRowToApproverItem(r: any) {
        return {
            id: r.id,
            imageName: null,
            imageUrl: r.imageUrl ?? null,
            articleNumber: r.articleNumber ?? null,
            division: r.division ?? null,
            subDivision: r.subDivision ?? null,
            majorCategory: r.majorCategory ?? null,
            mcCode: r.mcCode ?? null,
            vendorName: r.vendorName ?? null,
            vendorCode: r.vendorCode ?? null,
            designNumber: r.designNumber ?? null,
            season: r.season ?? null,
            year: r.year ?? null,
            hsnTaxCode: r.hsnTaxCode ?? null,
            approvalStatus: r.approvalStatus,
            fgCreatorApproved: r.fgCreatorApproved ?? 'PENDING',
            approvedAt: r.approvedAt?.toISOString() ?? null,
            sapSyncStatus: r.sapSyncStatus ?? 'NOT_SYNCED',
            sapSyncMessage: r.sapSyncMessage ?? null,
            sapArticleId: null,
            userName: r.userName ?? null,
            createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
            updatedAt: r.updatedAt?.toISOString?.() ?? r.updatedAt,
            bodyArticleType: r.bodyArticleType ?? null,
            collar: r.mCollarType ?? null,
            collarStyle: r.mCollarStyle ?? null,
            neck: r.mNeckType ?? null,
            neckDetails: r.mNeckStyle ?? null,
            placket: r.mPlacket ?? null,
            fatherBelt: r.mBltType ?? null,
            childBelt: r.mBltStyle ?? null,
            sleeve: r.mSleevesMainStyle ?? null,
            sleeveFold: r.mSleeveFold ?? null,
            bottomFold: r.mBtmFold ?? null,
            noOfPocket: r.mNoOfPocket ?? null,
            pocketType: r.mPocket ?? null,
            extraPocket: r.mExtraPocket ?? null,
            fit: r.mFit ?? null,
            pattern: r.mBodyStyle ?? null,
            length: r.mLength ?? null,
            mSet: r.mSet ?? null,
            bodyArticle: r.bodyArticleNumber ?? null,
            bodyArticleDescription: r.bodyArticleDescription ?? null,
            fWidth: r.width ?? null,
            width: r.width ?? null,
            roughCmpCost:        r.roughCmpCost ?? null,
            bodyConsumptionType: r.bodyConsumptionType ?? null,
            gsm:                 r.gsm ?? null,
            ratio:               r.ratio ?? null,
            consumptionKg:       r.consumptionKg ?? null,
            consumptionMeter:        r.consumptionMeter ?? null,
            preciseWidth:            r.preciseWidth ?? null,
            preciseGsm:              r.preciseGsm ?? null,
            preciseRatio:            r.preciseRatio ?? null,
            preciseConsumptionKg:    r.preciseConsumptionKg ?? null,
            preciseConsumptionMeter: r.preciseConsumptionMeter ?? null,
            pptNumber: null, source: null, rate: null, mrp: null,
            size: null, colour: null, fabricMainMvgr: null, composition: null,
            wash: null, referenceArticleNumber: null, referenceArticleDescription: null,
            fabricArticleNumber: null, fabricArticleDescription: null, mcDescription: null,
            segment: null, articleDescription: null, fashionGrid: null, articleType: null,
            yarn1: null, yarn2: null, weave: null, macroMvgr: null, mainMvgr: null,
            mFab2: null, finish: null, shade: null, weight: null, lycra: null,
        };
    }

    /**
     * Per-major-category basic trim cost from basic_trim_cost_master. Uses the workbook's own
     * "BASIC & TRIMS COST" column, falling back to packaging + thread (the same formula) for the
     * rows where that cell was left blank in the workbook.
     */
    private static async lookupBasicTrimCosts(majorCategories: (string | null | undefined)[]): Promise<Map<string, number>> {
        const keys = [...new Set(
            majorCategories.map((m) => (m ?? '').trim().toUpperCase()).filter(Boolean),
        )];
        if (keys.length === 0) return new Map();

        const rows = await prisma.$queryRaw<{ maj_cat: string; cost: string | null }[]>`
            SELECT UPPER(TRIM(maj_cat)) AS maj_cat,
                   COALESCE(basic_trims_cost, packaging_total + thread_cost)::text AS cost
            FROM basic_trim_cost_master
            WHERE UPPER(TRIM(maj_cat)) IN (${Prisma.join(keys)})
        `;
        return new Map(
            rows.filter((r) => r.cost != null).map((r) => [r.maj_cat, Number(r.cost)]),
        );
    }

    static getBodyArticleById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const row = await prisma.bodyArticleData.findUnique({ where: { id } });
        if (!row) return res.status(404).json({ error: 'Item not found' });
        const item = ApproverController.bodyRowToApproverItem(row);
        return res.json(item);
    };

    static updateBodyArticle = async (req: Request, res: Response) => {
        const { id } = req.params;
        const body = req.body as Record<string, unknown>;

        const data: Record<string, unknown> = {};
        for (const [clientKey, value] of Object.entries(body)) {
            const dbKey = ApproverController.BODY_FIELD_MAP[clientKey];
            if (dbKey) data[dbKey] = value === undefined ? null : value;
        }
        if (Object.keys(data).length === 0) {
            const row = await prisma.bodyArticleData.findUnique({ where: { id } });
            if (!row) return res.status(404).json({ error: 'Item not found' });
            const item = ApproverController.bodyRowToApproverItem(row);
            return res.json(item);
        }

        // If bodyArticleNumber is being set, check it isn't already owned by a different row
        if (data.bodyArticleNumber) {
            const conflict = await prisma.bodyArticleData.findFirst({
                where: { bodyArticleNumber: data.bodyArticleNumber as string, NOT: { id } },
                select: { id: true, bodyArticleDescription: true },
            });
            if (conflict) {
                return res.status(409).json({
                    error: `Body Article Number ${data.bodyArticleNumber} is already assigned to another record.`,
                });
            }
        }

        try {
            const row = await prisma.bodyArticleData.update({ where: { id }, data });
            const item = ApproverController.bodyRowToApproverItem(row);
            return res.json(item);
        } catch (err: any) {
            if (err?.code === 'P2002' && err?.meta?.target?.includes('body_article_number')) {
                return res.status(409).json({
                    error: `Body Article Number ${data.bodyArticleNumber} is already assigned to another record.`,
                });
            }
            throw err;
        }
    };

    static creatorConfirmBodyArticle = async (req: Request, res: Response) => {
        const { id } = req.params;
        const row = await prisma.bodyArticleData.findUnique({ where: { id } });
        if (!row) return res.status(404).json({ error: 'Item not found' });
        if (row.fgCreatorApproved === 'APPROVED') {
            return res.json(ApproverController.bodyRowToApproverItem(row));
        }
        const updated = await prisma.bodyArticleData.update({
            where: { id },
            data: { fgCreatorApproved: 'APPROVED' },
        });
        return res.json(ApproverController.bodyRowToApproverItem(updated));
    };

    static deleteBodyArticles = async (req: Request, res: Response) => {
        const { ids } = req.body as { ids?: string[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        const { count } = await prisma.bodyArticleData.deleteMany({ where: { id: { in: ids } } });
        return res.json({ deleted: count });
    };

    static submitBodyArticles = async (req: Request, res: Response) => {
        const { ids } = req.body as { ids?: string[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        const { submitBodyArticles } = await import('../services/zmmBodyArtCreationService');
        const result = await submitBodyArticles(ids);
        const allOk = result.results.every(r => r.success);
        return res.status(allOk ? 200 : 207).json(result);
    };

    static submitFabricArticleData = async (req: Request, res: Response) => {
        const { ids } = req.body as { ids?: string[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        const { submitFabricArticles } = await import('../services/zmmFabArtCreationService');
        const result = await submitFabricArticles(ids);
        const allOk = result.results.every(r => r.success);
        return res.status(allOk ? 200 : 207).json(result);
    };

    // ─── Fabric Article Data list (type=FG) ──────────────────────────────────────
    // pathType=new  → all non-APPROVED articles
    // pathType=created → approval_status=APPROVED (SAP-created articles)

    private static buildFabricArticleDataWhere(query: Record<string, string>) {
        const { pathType = 'new', status, division, subDivision, majorCategory, search, startDate, endDate, source } = query;

        // SRM mode: query fabric_article_data by source='SRM'
        // FG mode (default): query by fabricArticleType='FG'
        const isSrmMode = source === 'SRM';
        const where: any = isSrmMode ? { source: 'SRM' } : { fabricArticleType: 'FG' };

        if (pathType === 'new') {
            where.approvalStatus = 'PENDING';
        } else if (pathType === 'rejected') {
            where.approvalStatus = 'REJECTED';
        } else if (pathType === 'created') {
            where.approvalStatus = 'APPROVED';
        } else if (pathType === 'failed') {
            where.sapSyncStatus = 'FAILED';
        } else {
            if (status && status !== 'ALL') {
                const statuses = status.split(',').map((s: string) => s.trim()).filter(Boolean).filter(s => s !== 'APPROVED');
                where.approvalStatus = statuses.length === 1 ? statuses[0] : { in: statuses };
            } else {
                where.approvalStatus = { not: 'APPROVED' };
            }
        }

        if (division && division !== 'ALL') where.division = { contains: division, mode: 'insensitive' };
        if (subDivision && subDivision !== 'ALL') where.subDivision = { equals: subDivision, mode: 'insensitive' };
        if (majorCategory) where.majorCategory = { equals: majorCategory, mode: 'insensitive' };

        const sapSyncStatus = String(query.sapSyncStatus || '').trim().toUpperCase();
        if (['SYNCED', 'PENDING', 'FAILED', 'NOT_SYNCED'].includes(sapSyncStatus)) {
            where.sapSyncStatus = sapSyncStatus;
        }

        const dateField = pathType === 'created' ? 'approvedAt' : 'createdAt';
        if (startDate || endDate) {
            where[dateField] = {};
            if (startDate) where[dateField].gte = new Date(startDate);
            if (endDate)   where[dateField].lte = new Date(endDate);
        }

        if (search) {
            where.OR = [
                { fabricArticleNumber:      { contains: search, mode: 'insensitive' } },
                { fabricArticleDescription: { contains: search, mode: 'insensitive' } },
                { vendorName:              { contains: search, mode: 'insensitive' } },
                { vendorCode:              { contains: search, mode: 'insensitive' } },
                { designNumber:            { contains: search, mode: 'insensitive' } },
                { majorCategory:           { contains: search, mode: 'insensitive' } },
            ];
        }

        return { where, dateField };
    }

    private static FABRIC_ARTICLE_DATA_SELECT = {
        id: true,
        fabricArticleNumber: true, fabricArticleDescription: true,
        fabricArticleType: true,
        division: true, subDivision: true, majorCategory: true,
        vendorName: true, vendorCode: true,
        approvalStatus: true, approvedAt: true,
        sapSyncStatus: true, sapSyncMessage: true,
        imageUrl: true, backImageUrl: true, userName: true,
        createdAt: true, updatedAt: true,
        mFabDiv: true, mYarn: true, mFabMainMvgr1: true, mFabMainMvgr2: true,
        mConstruction: true, mOunz: true, mWidth: true, mWeave02: true,
        mCount: true, mWeave01: true, mComposition: true, mFinish: true,
        mGsm: true, mLycra: true, fabricRate: true, v2FabricRate: true, valueAddCost: true, articleFashionType: true,
        designNumber: true, pptNumber: true, mcDescription: true, source: true,
        rate: true, segment: true,
    } as const;

    static getFabricArticleDataItems = async (req: Request, res: Response) => {
        const query = req.query as Record<string, string>;
        const page = parseInt(query.page || '1', 10);
        const take = parseInt(query.limit || '50', 10);
        const skip = (page - 1) * take;
        const pathType = query.pathType || 'new';

        const { where } = ApproverController.buildFabricArticleDataWhere(query);

        const orderBy = pathType === 'created'
            ? ({ approvedAt: { sort: 'desc', nulls: 'last' } } as const)
            : ({ createdAt: 'desc' } as const);
        const select = ApproverController.FABRIC_ARTICLE_DATA_SELECT;

        const { rows, total } = ApproverController.isCardGroupBy(query.groupBy)
            ? await ApproverController.findGroupedPage(prisma.fabricArticleData, {
                where, select, skip, take, groupBy: query.groupBy,
                dateField: pathType === 'created' ? 'approvedAt' : 'createdAt',
            })
            : await Promise.all([
                prisma.fabricArticleData.findMany({ where, skip, take, orderBy, select }),
                prisma.fabricArticleData.count({ where }),
            ]).then(([rows, total]) => ({ rows, total }));

        const data = rows.map((r) => ApproverController.fabricArticleDataRowToItem(r));
        return res.json({ data, meta: { total, page, limit: take } });
    };

    static getFabricArticleDataExportAll = async (req: Request, res: Response) => {
        const query = req.query as Record<string, string>;
        const pathType = query.pathType || 'new';
        const { where } = ApproverController.buildFabricArticleDataWhere(query);

        const orderBy = pathType === 'created'
            ? ({ approvedAt: { sort: 'desc', nulls: 'last' } } as const)
            : ({ createdAt: 'desc' } as const);

        const rows = await prisma.fabricArticleData.findMany({ where, orderBy, select: ApproverController.FABRIC_ARTICLE_DATA_SELECT });
        const data = rows.map((r) => ApproverController.fabricArticleDataRowToItem(r));
        return res.json({ data });
    };

    static getFabricArticleDataById = async (req: Request, res: Response) => {
        const { id } = req.params;
        const row = await prisma.fabricArticleData.findUnique({ where: { id } });
        if (!row) return res.status(404).json({ error: 'Item not found' });
        return res.json(ApproverController.fabricArticleDataRowToItem(row));
    };

    // Delete FG-type fabric_article_data rows (called on Reject in FG New Articles page)
    static deleteFGFabricArticles = async (req: Request, res: Response) => {
        const { ids } = req.body as { ids?: string[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }
        const result = await prisma.fabricArticleData.deleteMany({
            where: { id: { in: ids }, fabricArticleType: 'FG' },
        });
        return res.json({ success: true, deleted: result.count });
    };

    // Client field → DB column mapping for fabric_article_data
    private static FABRIC_ARTICLE_DATA_FIELD_MAP: Record<string, string> = {
        division:                 'division',
        subDivision:              'subDivision',
        majorCategory:            'majorCategory',
        mcDescription:            'mcDescription',
        vendorName:               'vendorName',
        vendorCode:               'vendorCode',
        designNumber:             'designNumber',
        fabricArticleNumber:      'fabricArticleNumber',
        fabricArticleDescription: 'fabricArticleDescription',
        fabricRate:               'fabricRate',
        v2FabricRate:             'v2FabricRate',
        valueAddCost:             'valueAddCost',
        articleFashionType:       'articleFashionType',
        mrp:                      'rate',
        segment:                  'segment',
        // Fabric construction fields
        fabDiv:        'mFabDiv',
        yarn1:         'mYarn',
        mainMvgr:      'mFabMainMvgr1',
        fabricMainMvgr:'mFabMainMvgr2',
        fConstruction: 'mConstruction',
        fOunce:        'mOunz',
        fWidth:        'mWidth',
        mFab2:         'mWeave02',
        fCount:        'mCount',
        weave:         'mWeave01',
        composition:   'mComposition',
        finish:        'mFinish',
        gsm:           'mGsm',
        lycra:         'mLycra',
    };

    static updateFabricArticleData = async (req: Request, res: Response) => {
        const { id } = req.params;
        const body = req.body as Record<string, unknown>;

        const existing = await prisma.fabricArticleData.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Item not found' });

        // APPROVED articles are locked — only allow updating fields that don't affect SAP sync.
        const APPROVED_ALLOWED: Set<string> = new Set(['fabricArticleDescription', 'vendorFabricRate', 'fabricArticleNumber', 'imageUrl']);
        if (existing.approvalStatus === 'APPROVED') {
            const incoming = Object.keys(body).filter(k => ApproverController.FABRIC_ARTICLE_DATA_FIELD_MAP[k]);
            const blocked = incoming.filter(k => !APPROVED_ALLOWED.has(k));
            if (blocked.length > 0) {
                return res.status(403).json({ error: 'Cannot update an approved item. It is locked for SAP sync.' });
            }
        }

        const data: Record<string, unknown> = {};
        for (const [clientKey, value] of Object.entries(body)) {
            const dbKey = ApproverController.FABRIC_ARTICLE_DATA_FIELD_MAP[clientKey];
            if (dbKey) data[dbKey] = value === undefined ? null : value;
        }
        if (Object.keys(data).length === 0) {
            return res.json(ApproverController.fabricArticleDataRowToItem(existing));
        }
        const row = await prisma.fabricArticleData.update({ where: { id }, data });
        return res.json(ApproverController.fabricArticleDataRowToItem(row));
    };

    private static fabricVariantRowToItem(r: any) {
        return {
            id:                  r.id,
            genericArticleId:    r.genericArticleId ?? null,
            genericArticleNumber:r.genericArticleNumber ?? null,
            variantColor:        r.variantColor ?? null,
            variantArticleNumber:r.variantArticleNumber ?? null,
            division:            r.division ?? null,
            subDivision:         r.subDivision ?? null,
            majorCategory:       r.majorCategory ?? null,
            mcDescription:       r.mcDescription ?? null,
            vendorName:          r.vendorName ?? null,
            vendorCode:          r.vendorCode ?? null,
            designNumber:        r.designNumber ?? null,
            mrp:                 r.mrp != null ? Number(r.mrp) : null,
            rate:                r.rate != null ? Number(r.rate) : null,
            approvalStatus:      r.approvalStatus ?? 'PENDING',
            approvedAt:          r.approvedAt?.toISOString() ?? null,
            sapSyncStatus:       r.sapSyncStatus ?? 'NOT_SYNCED',
            sapSyncMessage:      r.sapSyncMessage ?? null,
            imageUrl:            r.imageUrl ?? null,
            userName:            r.userName ?? null,
            createdAt:           r.createdAt.toISOString(),
            updatedAt:           r.updatedAt.toISOString(),
        };
    }

    static getFabricArticleVariants = async (req: Request, res: Response) => {
        const { genericId } = req.params;
        const rows = await prisma.fabricVariantArticleData.findMany({
            where: { genericArticleId: genericId },
            orderBy: { createdAt: 'asc' },
        });
        return res.json({ data: rows.map((r) => ApproverController.fabricVariantRowToItem(r)) });
    };

    static addFabricArticleVariants = async (req: Request, res: Response) => {
        const { genericId } = req.params;
        const { colors, colorImages } = req.body as { colors?: string[]; colorImages?: Record<string, string> };

        if (!Array.isArray(colors) || colors.length === 0) {
            return res.status(400).json({ error: 'colors array is required' });
        }

        const parent = await prisma.fabricArticleData.findUnique({ where: { id: genericId } });
        if (!parent) return res.status(404).json({ error: 'Generic article not found' });

        const existing = await prisma.fabricVariantArticleData.findMany({
            where: { genericArticleId: genericId },
            select: { variantColor: true },
        });
        const existingColors = new Set(existing.map((e) => (e.variantColor ?? '').toUpperCase()));

        const toCreate = colors.filter((c) => !existingColors.has(c.toUpperCase()));
        if (toCreate.length === 0) return res.status(409).json({ error: 'All selected colors already exist' });

        const rows = await prisma.$transaction(
            toCreate.map((color) =>
                prisma.fabricVariantArticleData.create({
                    data: {
                        genericArticleId:     genericId,
                        genericArticleNumber: parent.fabricArticleNumber ?? null,
                        variantColor:         color,
                        division:             parent.division ?? null,
                        subDivision:          parent.subDivision ?? null,
                        majorCategory:        parent.majorCategory ?? null,
                        mcDescription:        parent.mcDescription ?? null,
                        vendorName:           parent.vendorName ?? null,
                        vendorCode:           parent.vendorCode ?? null,
                        designNumber:         parent.designNumber ?? null,
                        mrp:                  parent.rate ?? null,
                        imageUrl:             colorImages?.[color] ?? parent.imageUrl ?? null,
                        userName:             parent.userName ?? null,
                    },
                })
            )
        );

        return res.status(201).json({ count: rows.length, created: rows.map((r) => ApproverController.fabricVariantRowToItem(r)) });
    };

    static updateFabricArticleVariant = async (req: Request, res: Response) => {
        const { id } = req.params;
        const body = req.body as Record<string, unknown>;

        const existing = await prisma.fabricVariantArticleData.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Variant not found' });

        const ALLOWED_KEYS = new Set(['vendorName', 'vendorCode', 'mrp', 'rate', 'variantColor', 'imageUrl']);
        const data: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(body)) {
            if (!ALLOWED_KEYS.has(k)) continue;
            if (k === 'mrp' || k === 'rate') {
                data[k] = v !== '' && v != null ? Number(v) : null;
            } else {
                data[k] = v || null;
            }
        }

        if (Object.keys(data).length === 0) return res.json(ApproverController.fabricVariantRowToItem(existing));
        const row = await prisma.fabricVariantArticleData.update({ where: { id }, data });
        return res.json(ApproverController.fabricVariantRowToItem(row));
    };

    static retryFabricArticleVariants = async (req: Request, res: Response) => {
        const { genericId } = req.params;
        const parent = await prisma.fabricArticleData.findUnique({ where: { id: genericId } });
        if (!parent) return res.status(404).json({ error: 'Generic article not found' });
        if (!parent.fabricArticleNumber) {
            return res.status(400).json({ error: 'Parent fabric article has not been submitted to SAP yet' });
        }
        const { submitFabricVariants } = await import('../services/zmmFabArtCreationService');
        await submitFabricVariants(genericId, parent.fabricArticleNumber, parent);
        const variants = await prisma.fabricVariantArticleData.findMany({ where: { genericArticleId: genericId } });
        const synced = variants.filter((v) => v.sapSyncStatus === 'SYNCED').length;
        const failed = variants.filter((v) => v.sapSyncStatus === 'FAILED').length;
        return res.json({ synced, failed, message: `${synced} synced, ${failed} failed` });
    };

    static deleteFabricArticleVariant = async (req: Request, res: Response) => {
        const { id } = req.params;
        const existing = await prisma.fabricVariantArticleData.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Variant not found' });
        if (existing.approvalStatus === 'APPROVED') {
            return res.status(403).json({ error: 'Cannot delete an approved variant' });
        }
        await prisma.fabricVariantArticleData.delete({ where: { id } });
        return res.json({ success: true });
    };

    private static fabricArticleDataRowToItem(r: any) {
        return {
            id:                       r.id,
            isGeneric:                r.source === 'SRM',
            imageName:                null,
            imageUrl:                 r.imageUrl ?? null,
            backImageUrl:             r.backImageUrl ?? null,
            articleNumber:            r.fabricArticleNumber ?? null,
            fabricArticleNumber:      r.fabricArticleNumber ?? null,
            fabricArticleDescription: r.fabricArticleDescription ?? null,
            fabricArticleType:        r.fabricArticleType ?? null,
            division:                 r.division ?? null,
            subDivision:              r.subDivision ?? null,
            majorCategory:            r.majorCategory ?? null,
            mcCode:                   null,
            mcDescription:            r.mcDescription ?? null,
            vendorName:               r.vendorName ?? null,
            vendorCode:               r.vendorCode ?? null,
            approvalStatus:           (r.approvalStatus ?? 'PENDING') as 'PENDING' | 'APPROVED' | 'REJECTED',
            approvedAt:               r.approvedAt?.toISOString() ?? null,
            sapSyncStatus:            (r.sapSyncStatus ?? 'NOT_SYNCED') as any,
            sapSyncMessage:           r.sapSyncMessage ?? null,
            userName:                 r.userName ?? null,
            createdAt:                r.createdAt.toISOString(),
            updatedAt:                r.updatedAt.toISOString(),
            // Fabric construction fields
            fabDiv:      r.mFabDiv ?? null,
            yarn1:       r.mYarn ?? null,
            mainMvgr:    r.mFabMainMvgr1 ?? null,
            fabricMainMvgr: r.mFabMainMvgr2 ?? null,
            fConstruction: r.mConstruction ?? null,
            fOunce:      r.mOunz ?? null,
            fWidth:      r.mWidth ?? null,
            mFab2:       r.mWeave02 ?? null,
            fCount:      r.mCount ?? null,
            weave:       r.mWeave01 ?? null,
            composition: r.mComposition ?? null,
            finish:      r.mFinish ?? null,
            gsm:         r.mGsm ?? null,
            lycra:       r.mLycra ?? null,
            designNumber:       r.designNumber ?? null,
            fabricRate:         r.fabricRate != null ? Number(r.fabricRate) : null,
            v2FabricRate:       r.v2FabricRate != null ? Number(r.v2FabricRate) : null,
            valueAddCost:       r.valueAddCost != null ? Number(r.valueAddCost) : null,
            articleFashionType: r.articleFashionType ?? null,
            source: r.source ?? null,
            pptNumber: r.pptNumber ?? null,
            mrp: r.rate != null ? Number(r.rate) : null,
            segment: r.segment ?? null,
            // Fields not present in fabric_article_data — nulled out
            rate: null,
            size: null, colour: null, wash: null, shade: null, weight: null,
            referenceArticleNumber: null, referenceArticleDescription: null,
            articleDescription: null,
            fashionGrid: null, articleType: null,
            ageGroup: null, impAtrbt2: null,
            season: null, year: null, hsnTaxCode: null,
            collar: null, collarStyle: null, neck: null, neckDetails: null,
            placket: null, fatherBelt: null, childBelt: null,
            sleeve: null, sleeveFold: null, bottomFold: null,
            noOfPocket: null, pocketType: null, extraPocket: null,
            fit: null, pattern: null, length: null,
            bodyArticle: null, bodyArticleDescription: null,
            sapArticleId: null, approver: null,
        };
    }

    static createBodyArticleFromFG = async (req: Request, res: Response) => {
        const { ids, bodyDescriptions, attributeOverrides, submitNow } = req.body as {
            ids?: string[];
            submitNow?: boolean;
            // Per-id override for bodyArticleDescription (live computed value from frontend UI).
            bodyDescriptions?: Record<string, string | null>;
            // Per-id override for body construction attributes (unsaved localValues from Created page).
            attributeOverrides?: Record<string, {
                collar?: string | null; collarStyle?: string | null;
                neck?: string | null; neckDetails?: string | null;
                placket?: string | null; fatherBelt?: string | null; childBelt?: string | null;
                sleeve?: string | null; sleeveFold?: string | null; mSet?: string | null;
                bottomFold?: string | null; noOfPocket?: string | null;
                pocketType?: string | null; extraPocket?: string | null;
                fit?: string | null; pattern?: string | null; length?: string | null;
            }>;
        };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }

        const rawItems = await prisma.extractionResultFlat.findMany({
            where: { id: { in: ids } },
            select: {
                id: true, articleNumber: true, designNumber: true, division: true, subDivision: true,
                majorCategory: true, mcCode: true, vendorName: true, vendorCode: true,
                season: true, year: true, hsnTaxCode: true, imageUrl: true, userName: true,
                bodyArticleDescription: true,
                collar: true, collarStyle: true, neck: true, neckDetails: true,
                placket: true, fatherBelt: true, childBelt: true,
                sleeve: true, sleeveFold: true, mSet: true,
                bottomFold: true, noOfPocket: true, pocketType: true, extraPocket: true,
                fit: true, pattern: true, length: true,
                gsm: true,
            },
        });

        if (rawItems.length === 0) {
            return res.status(404).json({ error: 'No items found for the given ids' });
        }

        // Apply frontend-supplied overrides so unsaved attribute changes on the Created page
        // (before Modify is clicked) are used instead of stale DB values.
        const items = rawItems.map((item) => {
            const attrOv = attributeOverrides?.[item.id];
            return {
                ...item,
                bodyArticleDescription: bodyDescriptions?.[item.id] !== undefined
                    ? bodyDescriptions[item.id]
                    : item.bodyArticleDescription,
                ...(attrOv ? {
                    collar:      attrOv.collar      !== undefined ? attrOv.collar      : item.collar,
                    collarStyle: attrOv.collarStyle !== undefined ? attrOv.collarStyle : item.collarStyle,
                    neck:        attrOv.neck        !== undefined ? attrOv.neck        : item.neck,
                    neckDetails: attrOv.neckDetails !== undefined ? attrOv.neckDetails : item.neckDetails,
                    placket:     attrOv.placket     !== undefined ? attrOv.placket     : item.placket,
                    fatherBelt:  attrOv.fatherBelt  !== undefined ? attrOv.fatherBelt  : item.fatherBelt,
                    childBelt:   attrOv.childBelt   !== undefined ? attrOv.childBelt   : item.childBelt,
                    sleeve:      attrOv.sleeve      !== undefined ? attrOv.sleeve      : item.sleeve,
                    sleeveFold:  attrOv.sleeveFold  !== undefined ? attrOv.sleeveFold  : item.sleeveFold,
                    mSet:        attrOv.mSet        !== undefined ? attrOv.mSet        : item.mSet,
                    bottomFold:  attrOv.bottomFold  !== undefined ? attrOv.bottomFold  : item.bottomFold,
                    noOfPocket:  attrOv.noOfPocket  !== undefined ? attrOv.noOfPocket  : item.noOfPocket,
                    pocketType:  attrOv.pocketType  !== undefined ? attrOv.pocketType  : item.pocketType,
                    extraPocket: attrOv.extraPocket !== undefined ? attrOv.extraPocket : item.extraPocket,
                    fit:         attrOv.fit         !== undefined ? attrOv.fit         : item.fit,
                    pattern:     attrOv.pattern     !== undefined ? attrOv.pattern     : item.pattern,
                    length:      attrOv.length      !== undefined ? attrOv.length      : item.length,
                } : {}),
            };
        });

        // Check 1: a body article for the same majorCategory + bodyArticleDescription already exists.
        // Only a row that carries a body article number counts as "already present" — that is the
        // number the user is told to reuse. Rows still waiting in the New Articles tab have no
        // number yet, so blocking on them told the user an article "is already Present: N/A" and
        // left them with nothing to act on; those are caught at SAP submit instead
        // (zmmBodyArtCreationService blocks a duplicate grid with the real number).
        // This flat article's own row is excluded — Check 2 below owns that case.
        for (const item of items) {
            if (item.majorCategory && item.bodyArticleDescription) {
                const descMatch = await prisma.bodyArticleData.findFirst({
                    where: {
                        majorCategory:          { equals: item.majorCategory, mode: 'insensitive' },
                        bodyArticleDescription: { equals: item.bodyArticleDescription, mode: 'insensitive' },
                        bodyArticleNumber:      { not: null },
                        // Explicit OR rather than `flatId: { not: item.id }` so master rows
                        // uploaded without a flatId still count as duplicates.
                        OR: [{ flatId: null }, { flatId: { not: item.id } }],
                    },
                    select: { bodyArticleNumber: true },
                });
                if (descMatch) {
                    // Auto-fill bodyArticle on the flat row so the FG article card shows the number
                    if (descMatch.bodyArticleNumber) {
                        await prisma.extractionResultFlat.update({
                            where: { id: item.id },
                            data: { bodyArticle: descMatch.bodyArticleNumber },
                        }).catch(() => {});
                    }
                    return res.status(409).json({
                        error: `For this ${item.majorCategory} Major Category, Body Article is already Present: ${descMatch.bodyArticleNumber}`,
                        bodyArticleNumber: descMatch.bodyArticleNumber,
                        flatId: item.id,
                    });
                }
            }
        }

        // Check 2: per-flatId logic —
        //   a) APPROVED row with the same new desc → block (true duplicate, already approved)
        //   b) PENDING or REJECTED row exists → update with new attributes (re-submission)
        //   c) no matching row → create fresh
        const existing = await prisma.bodyArticleData.findMany({
            where: { flatId: { in: ids } },
            select: { id: true, flatId: true, bodyArticleNumber: true, majorCategory: true, sapSyncStatus: true, bodyArticleDescription: true, approvalStatus: true },
        });

        // Parse a GSM value that may be a range like "100 - 120" → average 110, or a single
        // number "150" → 150. Returns 0 (stored as null) when the source is blank/missing.
        const parseGsmAverage = (raw: string | null | undefined): number | null => {
            if (!raw?.trim()) return null;
            const parts = raw.trim().split(/\s*-\s*/).map(s => parseFloat(s)).filter(n => !isNaN(n));
            if (parts.length === 0) return null;
            return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100;
        };

        const bodyArticleData = (item: typeof items[0]) => {
            const gsmVal = parseGsmAverage(item.gsm);
            return {
            flatId:                 item.id,
            articleNumber:          item.articleNumber,
            designNumber:           item.designNumber,
            division:               item.division,
            subDivision:            item.subDivision,
            majorCategory:          item.majorCategory,
            mcCode:                 item.mcCode,
            vendorName:             item.vendorName,
            vendorCode:             item.vendorCode,
            season:                 item.season,
            year:                   item.year,
            hsnTaxCode:             item.hsnTaxCode,
            imageUrl:               item.imageUrl,
            userName:               item.userName,
            bodyArticleType:        'FG' as const,
            bodyArticleDescription: item.bodyArticleDescription,
            mCollarType:            item.collar,
            mCollarStyle:           item.collarStyle,
            mNeckType:              item.neck,
            mNeckStyle:             item.neckDetails,
            mPlacket:               item.placket,
            mBltType:               item.fatherBelt,
            mBltStyle:              item.childBelt,
            mSleevesMainStyle:      item.sleeve,
            mSleeveFold:            item.sleeveFold,
            mSet:                   item.mSet,
            mBtmFold:               item.bottomFold,
            mNoOfPocket:            item.noOfPocket,
            mPocket:                item.pocketType,
            mExtraPocket:           item.extraPocket,
            mFit:                   item.fit,
            mBodyStyle:             item.pattern,
            mLength:                item.length,
            gsm:                    gsmVal,
            preciseGsm:             gsmVal,
            };
        };

        // Group existing rows by flatId (multiple rows per flatId are possible)
        const existingRowsByFlatId = new Map<string, typeof existing>();
        for (const ex of existing) {
            const key = ex.flatId ?? '';
            if (!existingRowsByFlatId.has(key)) existingRowsByFlatId.set(key, []);
            existingRowsByFlatId.get(key)!.push(ex);
        }

        const toUpdate: Array<{ item: typeof items[0]; existingId: string }> = [];
        const toCreate: typeof items = [];

        for (const item of items) {
            const rows = existingRowsByFlatId.get(item.id) ?? [];

            // a) Block if the new desc is already APPROVED for this flatId — same message
            //    as Check 1 so the user knows which body article number to reuse.
            const approvedSameDesc = rows.find(
                (r) => r.approvalStatus === 'APPROVED'
                    && (r.bodyArticleDescription ?? '').trim() === (item.bodyArticleDescription ?? '').trim()
            );
            if (approvedSameDesc) {
                if (approvedSameDesc.bodyArticleNumber) {
                    await prisma.extractionResultFlat.update({
                        where: { id: item.id },
                        data: { bodyArticle: approvedSameDesc.bodyArticleNumber },
                    }).catch(() => {});
                }
                return res.status(409).json({
                    error: `For this ${approvedSameDesc.majorCategory} Major Category, Body Article is already Present: ${approvedSameDesc.bodyArticleNumber ?? 'N/A'}`,
                    bodyArticleNumber: approvedSameDesc.bodyArticleNumber ?? null,
                    flatId: item.id,
                    duplicateFlatIds: [item.id],
                });
            }

            // b) Update an existing PENDING or REJECTED row for this flatId
            const pendingOrRejected = rows.find(
                (r) => r.approvalStatus === 'PENDING' || r.approvalStatus === 'REJECTED'
            );
            if (pendingOrRejected) {
                toUpdate.push({ item, existingId: pendingOrRejected.id });
            } else {
                // c) No PENDING/REJECTED row — create fresh
                toCreate.push(item);
            }
        }

        // Collect (bodyArticleDataId → flatId) so we can write back SAP numbers when submitNow=true.
        type BodyEntry = { bodyRowId: string; flatId: string };
        const toSubmitEntries: BodyEntry[] = [];

        await Promise.all([
            ...toUpdate.map(({ item, existingId }) =>
                prisma.bodyArticleData.update({
                    where: { id: existingId },
                    data: {
                        ...bodyArticleData(item),
                        approvalStatus: submitNow ? 'APPROVED' : 'PENDING',
                        sapSyncStatus:  'NOT_SYNCED',
                        sapSyncMessage: null,
                    },
                }).then(() => { toSubmitEntries.push({ bodyRowId: existingId, flatId: item.id }); })
            ),
            ...toCreate.map((item) =>
                prisma.bodyArticleData.create({
                    data: {
                        ...bodyArticleData(item),
                        ...(submitNow ? { approvalStatus: 'APPROVED' } : {}),
                    },
                }).then((row) => { toSubmitEntries.push({ bodyRowId: row.id, flatId: item.id }); })
            ),
        ]);

        if (submitNow && toSubmitEntries.length > 0) {
            const { submitBodyArticles } = await import('../services/zmmBodyArtCreationService');
            const submitResult = await submitBodyArticles(toSubmitEntries.map((e) => e.bodyRowId));

            // Write the SAP-issued body article number back to extraction_results_flat.body_article
            await Promise.all(
                submitResult.results
                    .filter((r) => r.success && r.sapArticleNumber)
                    .map(async (r) => {
                        const entry = toSubmitEntries.find((e) => e.bodyRowId === r.id);
                        if (entry?.flatId) {
                            await prisma.extractionResultFlat.update({
                                where: { id: entry.flatId },
                                data: { bodyArticle: r.sapArticleNumber },
                            });
                        }
                    }),
            );

            return res.json({ success: true, created: toSubmitEntries.length, results: submitResult.results });
        }

        return res.json({ success: true, created: toSubmitEntries.length });
    };

    // Division → fabric master lookup. K/RFD_K → KNITS_MIX (mFabDiv K),
    // W/RFD_W → WOVEN_MIX (W), DNM → DENIM_MIX (D).
    // Static fabric master mapping from FABRIC MASTER MIX VDR.XLSX
    // Key = FG article's fabDiv value. All fabric_article_data fields come from here — never from the FG article's garment division.
    private static readonly DIVISION_TO_FABRIC: Record<string, { division: string; subDivision: string; majorCategory: string; mcDes: string; mFabDiv: string }> = {
        K:     { division: 'K', subDivision: 'K_MIX', majorCategory: 'KNITS_MIX', mcDes: 'KNITS_MIX', mFabDiv: 'K'     },
        RFD_K: { division: 'K', subDivision: 'K_MIX', majorCategory: 'KNITS_MIX', mcDes: 'KNITS_MIX', mFabDiv: 'RFD_K' },
        W:     { division: 'W', subDivision: 'W_MIX', majorCategory: 'WOVEN_MIX', mcDes: 'WOVEN_MIX', mFabDiv: 'W'     },
        RFD_W: { division: 'W', subDivision: 'W_MIX', majorCategory: 'WOVEN_MIX', mcDes: 'WOVEN_MIX', mFabDiv: 'RFD_W' },
        DNM:   { division: 'D', subDivision: 'D_MIX', majorCategory: 'DENIM_MIX', mcDes: 'DENIM_MIX', mFabDiv: 'DNM'   },
    };

    static createFabricArticleFromFG = async (req: Request, res: Response) => {
        const { ids, submitNow, skipFlatUpdate, overrides } = req.body as {
            ids?: string[];
            submitNow?: boolean;
            skipFlatUpdate?: boolean;
            // Optional field overrides (extraction_results_flat field names) sent by the
            // Created-page modify flow so the fabric article is built from current UI
            // values rather than potentially-stale DB values.
            overrides?: Record<string, unknown>;
        };
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }

        // Fetch Construction & Fabric fields from the source FG article rows
        const items = await prisma.extractionResultFlat.findMany({
            where: { id: { in: ids } },
            select: {
                id: true, articleNumber: true, designNumber: true, pptNumber: true,
                majorCategory: true, division: true, subDivision: true,
                vendorName: true, vendorCode: true,
                imageUrl: true, userName: true,
                fabricArticleDescription: true,
                autoBgt: true, roughV2: true, vendorFabricRate: true, finalCost: true,
                roughRatio: true, roughConsumptionKg: true, roughConsumptionMeter: true,
                preciseRatio: true, preciseConsumptionKg: true, preciseConsumptionMeter: true,
                cuttingBgtPrVal: true, cuttingActPrVal: true, cuttingVendorPrVal: true, cuttingFinalPrVal: true,
                stitchingBgtPrVal: true, stitchingActPrVal: true, stitchingVendorPrVal: true, stitchingFinalPrVal: true,
                ironingBgtPrVal: true, ironingActPrVal: true, ironingVendorPrVal: true, ironingFinalPrVal: true,
                finishingBgtPrVal: true, finishingActPrVal: true, finishingVendorPrVal: true, finishingFinalPrVal: true, totalBgtPrVal: true, totalActPrVal: true, totalVendorPrVal: true, totalFinalPrVal: true,
                bTrimType: true, bTrimTotalAutoBgt: true, bTrimTotalRoughV2: true, bTrimTotalVdrCost: true, bTrimTotalFinalCost: true,
                mBtnAutoBgt: true, mBtnRoughV2: true, mBtnVdrCost: true, mBtnFinalCost: true,
                dcAutoBgt: true, dcRoughV2: true, dcVdrCost: true, dcFinalCost: true,
                zipAutoBgt: true, zipRoughV2: true, zipVdrCost: true, zipFinalCost: true,
                patchAutoBgt: true, patchRoughV2: true, patchVdrCost: true, patchFinalCost: true,
                hTrfAutoBgt: true, hTrfRoughV2: true, hTrfVdrCost: true, hTrfFinalCost: true,
                elasticAutoBgt: true, elasticRoughV2: true, elasticVdrCost: true, elasticFinalCost: true,
                fusingAutoBgt: true, fusingRoughV2: true, fusingVdrCost: true, fusingFinalCost: true,
                badgeAutoBgt: true, badgeRoughV2: true, badgeVdrCost: true, badgeFinalCost: true,
                rivetAutoBgt: true, rivetRoughV2: true, rivetVdrCost: true, rivetFinalCost: true,
                tapeAutoBgt: true, tapeRoughV2: true, tapeVdrCost: true, tapeFinalCost: true,
                otherAutoBgt: true, otherRoughV2: true, otherVdrCost: true, otherFinalCost: true,
                adjusterAutoBgt: true, adjusterRoughV2: true, adjusterVdrCost: true, adjusterFinalCost: true,
                brotchAutoBgt: true, brotchRoughV2: true, brotchVdrCost: true, brotchFinalCost: true,
                buckleAutoBgt: true, buckleRoughV2: true, buckleVdrCost: true, buckleFinalCost: true,
                eyeletsAutoBgt: true, eyeletsRoughV2: true, eyeletsVdrCost: true, eyeletsFinalCost: true,
                hangingDRingAutoBgt: true, hangingDRingRoughV2: true, hangingDRingVdrCost: true, hangingDRingFinalCost: true,
                hookAutoBgt: true, hookRoughV2: true, hookVdrCost: true, hookFinalCost: true,
                labelAutoBgt: true, labelRoughV2: true, labelVdrCost: true, labelFinalCost: true,
                laceAutoBgt: true, laceRoughV2: true, laceVdrCost: true, laceFinalCost: true,
                pockettingFabricAutoBgt: true, pockettingFabricRoughV2: true, pockettingFabricVdrCost: true, pockettingFabricFinalCost: true,
                pockettingReadymadeAutoBgt: true, pockettingReadymadeRoughV2: true, pockettingReadymadeVdrCost: true, pockettingReadymadeFinalCost: true,
                santaAutoBgt: true, santaRoughV2: true, santaVdrCost: true, santaFinalCost: true,
                stopperAutoBgt: true, stopperRoughV2: true, stopperVdrCost: true, stopperFinalCost: true,
                tagAutoBgt: true, tagRoughV2: true, tagVdrCost: true, tagFinalCost: true,
                tasselsAutoBgt: true, tasselsRoughV2: true, tasselsVdrCost: true, tasselsFinalCost: true,
                mBtnRate: true, mBtnQty: true, dcRate: true, dcQty: true, zipRate: true, zipQty: true, patchRate: true, patchQty: true, hTrfRate: true, hTrfQty: true, elasticRate: true, elasticQty: true, fusingRate: true, fusingQty: true, badgeRate: true, badgeQty: true, rivetRate: true, rivetQty: true, tapeRate: true, tapeQty: true, otherRate: true, otherQty: true, adjusterRate: true, adjusterQty: true, brotchRate: true, brotchQty: true, buckleRate: true, buckleQty: true, eyeletsRate: true, eyeletsQty: true, hangingDRingRate: true, hangingDRingQty: true, hookRate: true, hookQty: true, labelRate: true, labelQty: true, laceRate: true, laceQty: true, pockettingFabricRate: true, pockettingFabricQty: true, pockettingReadymadeRate: true, pockettingReadymadeQty: true, santaRate: true, santaQty: true, stopperRate: true, stopperQty: true, tagRate: true, tagQty: true, tasselsRate: true, tasselsQty: true,
                printAutoBgt: true, printRoughV2: true, printVendorCost: true, printFinalCost: true,
                embAutoBgt: true, embRoughV2: true, embVendorCost: true, embFinalCost: true,
                washingAutoBgt: true, washingRoughV2: true, washingVendorCost: true, washingFinalCost: true,
                vaddTotalAutoBgt: true, vaddTotalRoughV2: true, vaddTotalVendorCost: true, vaddTotalFinalCost: true,
                pkgCostType: true, boppNetPrice: true, ctnNetPrice: true, barcodeNetPrice: true,
                kimbleNetPrice: true, taftaNetPrice: true, threadNetPrice: true,
                mrp: true, segment: true,
                articleFashionType: true,
                fabDiv: true, yarn1: true,
                mainMvgr: true, fabricMainMvgr: true,
                fConstruction: true, fOunce: true, fWidth: true,
                mFab2: true, fCount: true, weave: true,
                composition: true, finish: true, gsm: true, lycra: true,
            },
        });

        if (items.length === 0) {
            return res.status(404).json({ error: 'No items found for the given ids' });
        }

        // All fabric_article_data fields come from the static DIVISION_TO_FABRIC map (Excel reference),
        // keyed by the FG article's fabDiv (K/W/D/DNM). Never use the FG garment division (MENS/WOMENS etc.).
        type FabRowEntry = { fabricRowId: string; flatId: string };
        const toSubmit: FabRowEntry[] = [];

        for (const rawItem of items) {
            // Merge UI overrides (if provided) over the DB row so the fabric article
            // is built from the current UI values, not potentially-stale DB values.
            const item = overrides ? { ...rawItem, ...overrides } : rawItem;

            const desc = item.fabricArticleDescription;
            if (!desc) continue;

            const fabDivKey = (item.fabDiv || '').trim().toUpperCase();
            const mapped = ApproverController.DIVISION_TO_FABRIC[fabDivKey];
            if (!mapped) {
                return res.status(400).json({ error: `Cannot resolve fabric master for fabDiv "${item.fabDiv}". Expected K, W, D, or DNM.` });
            }

            const fabricFields = {
                fabricArticleType:        'FG',
                vendorName:               'MIX VENDOR',
                vendorCode:               '200681',
                designNumber:             item.designNumber,
                pptNumber:                item.pptNumber,
                rate:                     item.mrp ?? null,
                segment:                  item.segment ?? null,
                imageUrl:                 item.imageUrl,
                userName:                 item.userName,
                division:                 mapped.division,
                subDivision:              mapped.subDivision,
                majorCategory:            mapped.majorCategory,
                mcDescription:            mapped.mcDes,
                mFabDiv:                  mapped.mFabDiv,
                fabricArticleDescription: desc,
                articleFashionType:       'C',
                mYarn:           item.yarn1,
                mFabMainMvgr1:   item.mainMvgr,
                mFabMainMvgr2:   item.fabricMainMvgr,
                mConstruction:   item.fConstruction,
                mOunz:           item.fOunce,
                mWidth:          item.fWidth,
                mWeave02:        item.mFab2,
                mCount:          item.fCount,
                mWeave01:        item.weave,
                mComposition:    item.composition,
                mFinish:         item.finish,
                mGsm:            item.gsm,
                mLycra:          item.lycra,
                fabricRate:      item.vendorFabricRate ?? null,
            };

            // Priority 1: block if any row with same desc is already APPROVED and has a number
            const existingByDesc = await prisma.fabricArticleData.findFirst({
                where: {
                    fabricArticleDescription: { equals: desc, mode: 'insensitive' },
                    approvalStatus: 'APPROVED',
                    fabricArticleNumber: { not: null },
                },
                select: { id: true, fabricArticleNumber: true },
            });
            if (existingByDesc) {
                // Same as Create Body Article: auto-fill the existing number on the FG row so the
                // card shows it. Modify mode (skipFlatUpdate) stages it in the UI instead.
                if (!skipFlatUpdate && existingByDesc.fabricArticleNumber) {
                    await prisma.extractionResultFlat.update({
                        where: { id: item.id },
                        data: { fabricArticleNumber: existingByDesc.fabricArticleNumber },
                    }).catch(() => {});
                }
                return res.status(409).json({
                    error: `Fabric Article already created for this description. Fabric Article No: ${existingByDesc.fabricArticleNumber}`,
                    fabricArticleNumber: existingByDesc.fabricArticleNumber,
                });
            }

            // Priority 2: same flat_id, PENDING, no number → update and retry SAP
            const existingByFlatId = await prisma.fabricArticleData.findFirst({
                where: { flatId: item.id, approvalStatus: 'PENDING', fabricArticleNumber: null },
                select: { id: true },
            });
            if (existingByFlatId) {
                await prisma.fabricArticleData.update({
                    where: { id: existingByFlatId.id },
                    data: fabricFields,
                });
                toSubmit.push({ fabricRowId: existingByFlatId.id, flatId: item.id });
                continue;
            }

            // Priority 3: create a fresh row for this flat_id
            const newRow = await prisma.fabricArticleData.create({
                data: { flatId: item.id, ...fabricFields },
            });
            toSubmit.push({ fabricRowId: newRow.id, flatId: item.id });
        }

        if (toSubmit.length === 0) {
            return res.json({ success: true, created: 0, results: [] });
        }

        // Immediately submit to SAP and write fabricArticleNumber back to extraction_results_flat.
        // When skipFlatUpdate=true (modify-mode flow), the SAP number is returned to the
        // frontend so it can be staged as a pending change and saved only when Modify is clicked.
        if (submitNow) {
            const { submitFabricArticles } = await import('../services/zmmFabArtCreationService');
            const submitResult = await submitFabricArticles(toSubmit.map((e) => e.fabricRowId));

            if (!skipFlatUpdate) {
                await Promise.all(
                    submitResult.results
                        .filter((r) => r.success && r.sapArticleNumber)
                        .map(async (r) => {
                            const entry = toSubmit.find((e) => e.fabricRowId === r.id);
                            if (entry?.flatId) {
                                await prisma.extractionResultFlat.update({
                                    where: { id: entry.flatId },
                                    data: { fabricArticleNumber: r.sapArticleNumber },
                                });
                            }
                        }),
                );
            }

            return res.json({ success: true, created: toSubmit.length, results: submitResult.results });
        }

        return res.json({ success: true, created: toSubmit.length });
    };

    static getMajorCategoryDetails = async (req: Request, res: Response) => {
        const { div, mcStatus, search } = req.query as Record<string, string>;

        const where: any = {};
        if (div && div !== 'ALL') where.div = { equals: div, mode: 'insensitive' };
        if (mcStatus && mcStatus !== 'ALL') where.mcStatus = mcStatus;
        if (search) {
            where.OR = [
                { majCat:  { contains: search, mode: 'insensitive' } },
                { mcCode:  { contains: search, mode: 'insensitive' } },
                { mcDes:   { contains: search, mode: 'insensitive' } },
                { hsnCode: { contains: search, mode: 'insensitive' } },
                { subDiv:  { contains: search, mode: 'insensitive' } },
            ];
        }

        const rows = await prisma.majorCategoryDetails.findMany({
            where,
            orderBy: [{ div: 'asc' }, { subDiv: 'asc' }, { majCat: 'asc' }],
        });

        return res.json({ data: rows, total: rows.length });
    };

    // ─── GM Article SAP Submission ───────────────────────────────────────────────

    static submitGmArticles = async (req: Request, res: Response): Promise<void> => {
        const { ids } = req.body as { ids?: string[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'ids array is required' });
            return;
        }
        const { submitGmArticles } = await import('../services/zmmGMArtCreationService');
        const result = await submitGmArticles(ids, (req as any).user?.name ?? null);

        // Then create their colour × size variants in SAP (ZMM_VAR_ART_CRT_V8), like FG.
        const createdIds = result.results.filter(r => r.success).map(r => r.id);
        let variants: GmVariantSyncSummary | null = null;
        if (createdIds.length > 0) {
            try {
                const userId = (req as any).user?.id;
                variants = await syncGmVariantsToSap(createdIds, userId ? Number(userId) : null);
            } catch (err: any) {
                console.error('[GM_VARIANTS] Variant sync after submit failed:', err?.message);
            }
        }

        const allOk = result.results.every(r => r.success) && (!variants || variants.failed === 0);
        res.status(allOk ? 200 : 207).json({ ...result, variants });
    };

    // POST /api/approver/gm-articles/:genericId/retry-variants
    // Re-sends GM variants without an article number (FAILED / NOT_SYNCED / PENDING).
    static retryGmArticleVariants = async (req: Request, res: Response) => {
        const { genericId } = req.params;
        const generic = await prisma.gmArticleData.findUnique({
            where: { id: genericId },
            select: { id: true, gmArticleNumber: true },
        });
        if (!generic) return res.status(404).json({ error: 'GM article not found' });
        if (!generic.gmArticleNumber) {
            return res.status(400).json({ error: 'Generic article is not created in SAP yet — submit it first' });
        }
        const userId = (req as any).user?.id;
        const summary = await syncGmVariantsToSap([genericId], userId ? Number(userId) : null);
        const total = summary.synced + summary.failed;
        return res.json({
            message: total === 0 ? 'No variants need SAP sync' : `${summary.synced} synced, ${summary.failed} failed`,
            synced: summary.synced,
            failed: summary.failed,
        });
    };
}
