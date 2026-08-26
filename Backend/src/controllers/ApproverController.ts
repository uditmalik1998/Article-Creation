import { Request, Response } from 'express';
import { ApprovalStatus, SapSyncStatus, Prisma } from '../generated/prisma';
import fs from 'fs';
import path from 'path';
import { getHsnCodeByMcCode, getMcCodeByMajorCategory } from '../utils/mcCodeMapper';
import { parseNumericValue } from '../utils/mrpCalculator';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';
import { syncApprovedItemsToSap } from '../services/sapSyncService';
import { syncArticlesToSapViaRfc, buildModifyChangesPayload, previewRfcPayloads } from '../services/zmmArtCreationService';
import { patchArticleAttributes } from '../services/sapModifyService';
import { FLAT_TO_RFC, FLAT_TO_SAP_KEY } from '../data/flatToRfcMap';
import { randomUUID } from 'crypto';
import { validateAgainstNationalGrid } from '../services/nationalGridValidation';
import { syncVariantsToSapViaRfc } from '../services/zmmVarArtCreationService';
import { storageService, type WatermarkLabel } from '../services/storageService';
import { ARTICLE_DESCRIPTION_SOURCE_FIELDS, buildArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { prismaClient as prisma } from '../utils/prisma';
import { syncGenericToVariants, addColorVariants, getSizesForMajCat, isSizeAllowed } from '../services/variantCreationService';
import { hasVendorCode, isValidVendorCode, normalizeVendorCode } from '../utils/vendorCode';
import { mirror360FlatUpdate } from '../utils/mirror360Flat';

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
    'cmtpCost', 'cmpCost', 'fabCost',
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

export class ApproverController {
    private static readonly STARTUP_BACKFILL_BATCH_SIZE = parseInt(process.env.STARTUP_BACKFILL_BATCH_SIZE || '250', 10);
    private static readonly STARTUP_BACKFILL_DELAY_MS = parseInt(process.env.STARTUP_BACKFILL_DELAY_MS || '15000', 10);
    private static readonly STARTUP_BACKFILLS_ENABLED = String(process.env.STARTUP_BACKFILLS_ENABLED ?? 'true').toLowerCase() !== 'false';
    private static readonly STARTUP_BACKFILLS_IN_DEV = String(process.env.STARTUP_BACKFILLS_IN_DEV ?? 'false').toLowerCase() === 'true';
    private static readonly APPROVER_ATTRIBUTES_CACHE_TTL_MS = parseInt(process.env.APPROVER_ATTRIBUTES_CACHE_TTL_MS || '300000', 10);
    private static startupBackfillRunning = false;
    private static attributesCache: { data: any[]; expiresAt: number } | null = null;
    private static pendingAttributesLoad: Promise<any[]> | null = null;
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
            const segment = getSegmentByCategoryAndMrp(row.majorCategory, row.mrp);
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

    // Backfill isGeneric=true for SRM records that were created before the fix.
    // SRM articles are always standalone generics — they should never be variants.
    private static async backfillSrmIsGeneric(): Promise<number> {
        const result = await prisma.extractionResultFlat.updateMany({
            where: {
                source: 'SRM',
                isGeneric: false
            },
            data: { isGeneric: true }
        });
        if (result.count > 0) {
            console.log(`[Backfill] Set isGeneric=true for ${result.count} SRM records`);
        }
        return result.count;
    }

    // Backfill variantColor (and colour) for existing size variants that are missing them.
    // Looks up each variant's generic article and copies its colour.
    // Capped at STARTUP_BACKFILL_BATCH_SIZE rows per run to avoid holding DB connections
    // for minutes and starving normal user requests.
    private static async backfillVariantColors(): Promise<number> {
        // Limit rows fetched per startup run — prevents the N individual updates from
        // holding all pooled DB connections for 10–15 min on large datasets.
        const variants = await prisma.extractionResultFlat.findMany({
            where: {
                isGeneric: false,
                genericArticleId: { not: null },
                OR: [
                    { variantColor: null },
                    { colour: null }
                ]
            },
            select: { id: true, colour: true, variantColor: true, genericArticleId: true },
            take: ApproverController.STARTUP_BACKFILL_BATCH_SIZE
        });

        if (variants.length === 0) return 0;

        // Group by genericArticleId to batch the generic lookup into one query
        const genericIds = [...new Set(variants.map(v => v.genericArticleId!))];
        const generics = await prisma.extractionResultFlat.findMany({
            where: { id: { in: genericIds } },
            select: { id: true, colour: true }
        });
        const genericColourMap = new Map(generics.map(g => [g.id, g.colour]));

        // Group variants by their resolved colour so we can do one updateMany per colour
        // instead of one update per row (avoids N individual DB round-trips).
        const idsByColour = new Map<string, string[]>();
        for (const v of variants) {
            const colour = v.colour || genericColourMap.get(v.genericArticleId!) || null;
            if (!colour) continue;
            const ids = idsByColour.get(colour) || [];
            ids.push(v.id);
            idsByColour.set(colour, ids);
        }

        if (idsByColour.size === 0) return 0;

        const updates = Array.from(idsByColour.entries()).map(([colour, ids]) =>
            prisma.extractionResultFlat.updateMany({
                where: { id: { in: ids } },
                data: { variantColor: colour, colour }
            })
        );

        const results = await Promise.all(updates);
        const count = results.reduce((sum, r) => sum + r.count, 0);
        console.log(`[Backfill] Fixed variantColor for ${count} variant rows`);
        return count;
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
                await ApproverController.backfillSrmIsGeneric(); await pause();
                await ApproverController.backfillMissingMcCodes({}); await pause();
                await ApproverController.backfillMissingHsnCodes({}); await pause();
                await ApproverController.backfillMissingSegments({}); await pause();
                await ApproverController.backfillMissingYears({}); await pause();
                await ApproverController.backfillMissingSeasonCodes({}); await pause();
                // Article description backfill disabled — new formula applied to new articles only
                // await ApproverController.refreshArticleDescriptions({}); await pause();
                await ApproverController.backfillVariantColors();
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

    static async getItems(req: Request, res: Response) {
        try {
            const { status, division, subDivision, majorCategory, startDate, endDate, search, page = 1, limit = 50, pathType, source, presentationsType } = req.query;

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
                status, division, subDivision, majorCategory, startDate, endDate, search, page, limit, pathType, source, presentationsType,
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
                }
            };

            let items: any[];
            if (cachedCount && cachedCount.expiresAt > Date.now()) {
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

            // Variant-only extra fields
            const variantSelect = {
                ...sharedSelect,
                variantSize: true,
                variantColor: true,
                sapArticleId: true,
                genericArticleId: true,
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

            // Fetch SAP-created variants (own article number present), chunked to bound the IN clause.
            const variantsByGeneric = new Map<string, any[]>();
            const CHUNK = 1000;
            for (let i = 0; i < genericIds.length; i += CHUNK) {
                const chunk = genericIds.slice(i, i + CHUNK);
                if (chunk.length === 0) continue;
                const vs = await prisma.extractionResultFlat.findMany({
                    where: {
                        genericArticleId: { in: chunk },
                        isGeneric: false,
                        articleNumber: { not: null },
                        NOT: { articleNumber: '' },
                    },
                    orderBy: [{ variantColor: 'asc' }, { variantSize: 'asc' }],
                    select: variantSelect,
                });
                for (const v of vs) {
                    const key = (v as any).genericArticleId as string;
                    if (!variantsByGeneric.has(key)) variantsByGeneric.set(key, []);
                    variantsByGeneric.get(key)!.push(v);
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

    // Get master attributes for dropdowns
    static async getAttributes(req: Request, res: Response) {
        try {
            const cached = ApproverController.attributesCache;
            let attributes = cached && cached.expiresAt > Date.now() ? cached.data : null;

            if (!attributes) {
                if (!ApproverController.pendingAttributesLoad) {
                    ApproverController.pendingAttributesLoad = prisma.masterAttribute.findMany({
                        where: { isActive: true },
                        include: {
                            allowedValues: {
                                where: { isActive: true },
                                orderBy: { displayOrder: 'asc' }
                            }
                        },
                        orderBy: { displayOrder: 'asc' }
                    }).then((rows) => {
                        ApproverController.attributesCache = {
                            data: rows,
                            expiresAt: Date.now() + ApproverController.APPROVER_ATTRIBUTES_CACHE_TTL_MS
                        };
                        return rows;
                    }).finally(() => {
                        ApproverController.pendingAttributesLoad = null;
                    });
                }

                attributes = await ApproverController.pendingAttributesLoad;
            }

            return res.json(attributes);
        } catch (error) {
            console.error('Error fetching attributes:', error);
            return res.status(500).json({ error: 'Failed to fetch attributes' });
        }
    }

    // Fetch a single item by id — used by the detail page on direct URL access
    static async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const item = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: {
                    id: true, imageName: true, imageUrl: true, imageUncPath: true,
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
                    approver: { select: { name: true, email: true } },
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

            const item = await prisma.extractionResultFlat.findUnique({
                where: { id },
                select: { approvalStatus: true }
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

            // Validate majorCategory — allow garment MC code list OR fabric_article_master (maj_cat).
            if (data.majorCategory !== undefined && data.majorCategory !== null) {
                const majorCategoryText = String(data.majorCategory).trim();
                if (majorCategoryText) {
                    const garmentMcCode = getMcCodeByMajorCategory(majorCategoryText);
                    if (garmentMcCode) {
                        data.mcCode = garmentMcCode;
                        data.hsnTaxCode = getHsnCodeByMcCode(garmentMcCode) || null;
                    } else {
                        const fabMaster = await prisma.fabricArticleMaster.findFirst({
                            where: { majCat: { equals: majorCategoryText, mode: 'insensitive' } },
                            orderBy: { id: 'asc' },
                            select: { mcCode: true, hsnCd: true },
                        });
                        if (!fabMaster) {
                            return res.status(400).json({
                                error: `Invalid majorCategory '${majorCategoryText}'. Please use values from mc code list (mc des).`
                            });
                        }
                        data.mcCode = fabMaster.mcCode || null;
                        data.hsnTaxCode = fabMaster.hsnCd || null;
                    }
                }
            } else if (data.majorCategory !== undefined) {
                // majorCategory explicitly set to null/empty — clear derived fields
                data.mcCode = null;
                data.hsnTaxCode = null;
            } else if (data.mcCode !== undefined) {
                data.hsnTaxCode = getHsnCodeByMcCode(data.mcCode) || null;
            }

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
                    pdStatus: true
                }
            });

            if (!existingItem) {
                return res.status(404).json({ error: 'Item not found' });
            }

            // Prevent updating approved items
            if (existingItem.approvalStatus === 'APPROVED') {
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
            data.articleDescription = buildArticleDescription(descriptionSource, 40, {
                excludeFields: await getExcludedDescriptionFields(majCatForDescCheck) as any,
            });

            const updated = await prisma.extractionResultFlat.update({
                where: { id },
                data
            });

            // Mirror to 360article.article_360_flat (fire-and-forget)
            void mirror360FlatUpdate(id, data).catch((err: any) => console.error('[mirror360] update failed:', err?.message));

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
            const MODIFY_LOCKED_FIELDS = new Set<string>([
                'vendorCode',    // VENDOR
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
                } else if (value === '') {
                    value = null;
                }
                data[field] = value;
            }

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
                const oldStr = oldVal == null ? null : String(oldVal);
                const newStr = newVal == null ? null : String(newVal);
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

            // Mirror to 360article.article_360_flat (fire-and-forget)
            void mirror360FlatUpdate(id, data).catch((err: any) => console.error('[mirror360] modify update failed:', err?.message));

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

    static async approveItems(req: Request, res: Response) {
        ApproverController.itemsCache.clear();
        ApproverController.countCache.clear();
        try {
            const { ids } = req.body; // Array of UUIDs
            if (!Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: 'No items selected' });
            }

            // @ts-ignore - Assuming userId is added to req by auth middleware
            const userId = req.user?.id;

            // ── Auto-generate color variants from the BOM colour ──────────────────
            // On "Save & Submit" the approver approves directly; before approval we
            // create one variant per Major-Category size for each generic's BOM
            // colour (idempotent — addColorVariants skips combos that already
            // exist, e.g. those added manually via "Add Color"). If a generic has a
            // colour but its Major Category has no sizes configured, block with a
            // clear message since no variants could be created.
            const genericsToVariant = await prisma.extractionResultFlat.findMany({
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
                approvalStatus: 'PENDING'
            };

            // RBAC: Enforce scope by role
            ApproverController.applyApproverScope(whereClause, req.user);

            // Lightweight pre-approval fill: only fix missing mcCode/hsnTaxCode on the exact rows being approved
            const rowsToFix = await prisma.extractionResultFlat.findMany({
                where: { ...whereClause, mcCode: null, majorCategory: { not: null } },
                select: { id: true, majorCategory: true }
            });
            for (const row of rowsToFix) {
                const mc = getMcCodeByMajorCategory(row.majorCategory);
                if (mc) {
                    void prisma.extractionResultFlat.update({
                        where: { id: row.id },
                        data: { mcCode: mc, hsnTaxCode: getHsnCodeByMcCode(mc) || null }
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
                await prisma.extractionResultFlat.updateMany({
                    where: { genericArticleId: { in: approvedGenericIds }, isGeneric: false, approvalStatus: 'PENDING' },
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
                    select: { id: true, majorCategory: true, ...Object.fromEntries(FLAT_TO_RFC.map((m) => [m.flat, true])) } as any,
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
                    mcCode: true, hsnTaxCode: true, articleDescription: true, fashionGrid: true,
                    season: true, year: true, articleType: true, referenceArticleNumber: true,
                    referenceArticleDescription: true, imageUrl: true, imageName: true,
                    sapArticleId: true, isGeneric: true, genericArticleId: true,
                    colour: true, variantSize: true, variantColor: true,
                    attrArticleNums: true, source: true, createdAt: true,
                    srmUniqueId: true,
                }
            });

            console.log(`[APPROVE_DEBUG] approvedItems=${approvedItems.length}, ids=${approvedItems.map(i => i.id).join(',')}`);
            approvedItems.forEach(i => console.log(`[APPROVE_DEBUG] id=${i.id} majorCategory="${i.majorCategory}" finish="${i.finish}"`));
            const syncResults = await syncArticlesToSapViaRfc(approvedItems);
            const syncOk = syncResults.filter((r: any) => r.success).length;
            console.log(`[APPROVE_DEBUG] syncResults: ${syncOk}/${syncResults.length} succeeded`);
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

            // Mirror approval + SAP sync outcome to 360article.article_360_flat
            void Promise.all(finalizedSyncResults.map((syncResult: any) => {
                const approvedItem = approvedItemById.get(syncResult.id);
                return mirror360FlatUpdate(syncResult.id, {
                    approvalStatus:  'APPROVED',
                    sapSyncStatus:   syncResult.success ? 'SYNCED' : 'FAILED',
                    sapSyncMessage:  syncResult.message ?? null,
                    sapArticleId:    syncResult.sapArticleNumber ?? null,
                    articleNumber:   syncResult.sapArticleNumber ?? approvedItem?.articleNumber ?? null,
                    imageUrl:        syncResult.approvedImageUrl ?? approvedItem?.imageUrl ?? null,
                });
            })).catch((err: any) => console.error('[mirror360] approval mirror failed:', err?.message));

            // Fetch all variants for successfully synced generics before Phase 2,
            // so we can upload their images immediately alongside the generic.
            const earlySuccessIds = finalizedSyncResults
                .filter((r: any) => r.success && r.sapArticleNumber)
                .map((r: any) => r.id);
            const variantsForUpload = earlySuccessIds.length > 0
                ? await prisma.extractionResultFlat.findMany({
                    where: { genericArticleId: { in: earlySuccessIds }, isGeneric: false },
                    select: { id: true, genericArticleId: true, variantColor: true, colour: true, imageUrl: true },
                })
                : [];
            // Group variants by their generic's DB id
            const variantsByGenericId_img = new Map<string, typeof variantsForUpload>();
            for (const v of variantsForUpload) {
                const gId = v.genericArticleId!;
                if (!variantsByGenericId_img.has(gId)) variantsByGenericId_img.set(gId, []);
                variantsByGenericId_img.get(gId)!.push(v);
            }

            // Phase 2: Upload approved image only after article creation is persisted.
            // Also upload all variant images here using generic SAP number + variant color.
            await Promise.all(finalizedSyncResults.map(async (syncResult: any) => {
                if (!syncResult.success || !syncResult.sapArticleNumber) {
                    console.log(`⏭ Skipping approved image upload for ${syncResult.id}: success=${syncResult.success}, articleNumber=${syncResult.sapArticleNumber || 'none'}`);
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
                    console.log(`📦 Copying approved image for article ${syncResult.sapArticleNumber} from source to article-master bucket...`);

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
                    console.log(`✅ Generic image saved to article-master: ${approvedImageUpload.key}`);
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
                console.log(`[VARIANT_IMG] ${variantsToUpload.length}/${variants.length} variant(s) to upload for generic ${baseArticleNumber}`);
                await Promise.allSettled(variantsToUpload.map(async (v) => {
                    const colorCode = v.variantColor || v.colour || undefined;
                    console.log(`[VARIANT_IMG] Uploading: variantId=${v.id} base=${baseArticleNumber} color=${colorCode} src=${v.imageUrl}`);
                    try {
                        const upload = await storageService.uploadApprovedImageFromSourceUrl(
                            String(v.imageUrl),
                            baseArticleNumber,
                            undefined,
                            colorCode ?? undefined,
                        );
                        await prisma.extractionResultFlat.update({
                            where: { id: v.id },
                            data: { imageUrl: upload.url },
                        });
                        console.log(`✅ [VARIANT_IMG] Saved to article-master: ${upload.key}`);
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
                await prisma.extractionResultFlat.updateMany({
                    where: { genericArticleId: { in: failedIds }, isGeneric: false },
                    data: { approvalStatus: ApprovalStatus.PENDING, sapSyncStatus: SapSyncStatus.NOT_SYNCED },
                });
            }
            const successfullyApprovedIds = ids.filter((id: string) => !failedIds.includes(id));

            // ── Variant RFC sync ─────────────────────────────────────────────
            // For each successfully synced generic article, create its color/size
            // variants in SAP via ZMM_VAR_ART_CREATION_RFC.
            console.log(`[VARIANT_RFC] successfullyApprovedIds=${JSON.stringify(successfullyApprovedIds)}`);
            if (successfullyApprovedIds.length > 0) {
                try {
                    const allVariants = await prisma.extractionResultFlat.findMany({
                        where: {
                            genericArticleId: { in: successfullyApprovedIds },
                            isGeneric: false
                        },
                        select: {
                            id: true, genericArticleId: true, variantSize: true,
                            variantColor: true, colour: true, vendorCode: true,
                            rate: true, mrp: true, sapArticleId: true,
                            approvalStatus: true, sapSyncStatus: true,
                            imageUrl: true, articleNumber: true,
                            weight: true, variantWeight: true,
                        }
                    });

                    console.log(`[VARIANT_RFC] allVariants fetched=${allVariants.length} for genericIds=${JSON.stringify(successfullyApprovedIds)}`);
                    allVariants.forEach(v => console.log(`[VARIANT_RFC] variant id=${v.id} genericArticleId=${v.genericArticleId} size=${v.variantSize} colour=${v.colour} variantColor=${v.variantColor}`));

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
                        console.log(`[VARIANT_RFC] genericSapArticleMap=${JSON.stringify(Object.fromEntries(genericSapArticleMap))}`);

                        const variantSyncResults = await syncVariantsToSapViaRfc(variantsByGenericId, genericSapArticleMap);
                        console.log(`[VARIANT_RFC] ${variantSyncResults.filter((r: any) => r.success).length}/${variantSyncResults.length} variant(s) synced to SAP`);

                        const variantSyncUpdates = variantSyncResults.map((vResult: any) => {
                            const data: any = {
                                sapSyncStatus: vResult.success ? SapSyncStatus.SYNCED : SapSyncStatus.FAILED,
                                sapSyncMessage: vResult.message
                            };
                            if (vResult.sapArticleNumber) {
                                data.sapArticleId = vResult.sapArticleNumber;
                                data.articleNumber = vResult.sapArticleNumber;
                            }
                            if (vResult.success && vResult.fabricArticleNumber) {
                                data.fabricArticleNumber = vResult.fabricArticleNumber;
                            }
                            if (vResult.success && vResult.fabricArticleDescription) {
                                data.fabricArticleDescription = vResult.fabricArticleDescription;
                            }
                            return prisma.extractionResultFlat.update({
                                where: { id: vResult.id },
                                data
                            });
                        });

                        if (variantSyncUpdates.length > 0) {
                            await Promise.allSettled(variantSyncUpdates);
                        }
                    }
                } catch (varErr: any) {
                    console.error('[VARIANT_RFC] Variant sync failed (non-fatal):', varErr?.message);
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
                    SELECT id FROM public.extraction_results_flat
                    WHERE is_generic = true
                      AND approval_status::text = 'APPROVED'
                      AND sap_sync_status::text = 'PENDING'
                      AND (sap_lock_until IS NULL OR sap_lock_until < NOW())
                    ORDER BY approved_at ASC
                    LIMIT ${batchSize}
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id
            `;
            if (claimed.length === 0) return { processed: 0, synced: 0, failed: 0 };
            const ids = claimed.map((c) => c.id);

            const remaining = await prisma.extractionResultFlat.count({
                where: { isGeneric: true, approvalStatus: 'APPROVED', sapSyncStatus: SapSyncStatus.PENDING },
            });
            console.log(`[ApprovalSync] Claimed ${ids.length} approved article(s) to sync (${remaining} still queued)`);

            const r = await ApproverController.syncApprovedToSap(ids);
            ApproverController.itemsCache.clear();
            ApproverController.countCache.clear();
            console.log(`[ApprovalSync] Done — synced:${r.synced} failed:${r.failed}`);
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

            // Mirror rejection to 360article (fire-and-forget)
            void Promise.all(ids.map((rid: string) =>
                mirror360FlatUpdate(rid, { approvalStatus: 'REJECTED', sapSyncStatus: 'NOT_SYNCED' })
            )).catch((err: any) => console.error('[mirror360] rejection mirror failed:', err?.message));

            // Auto-reject all variants of rejected generic articles
            const rejectedIds = ids;
            const variantsToReject = await prisma.extractionResultFlat.findMany({
                where: { genericArticleId: { in: rejectedIds }, isGeneric: false },
                select: { id: true }
            });
            await prisma.extractionResultFlat.updateMany({
                where: {
                    genericArticleId: { in: rejectedIds },
                    isGeneric: false
                },
                data: {
                    approvalStatus: 'REJECTED',
                    sapSyncStatus: SapSyncStatus.NOT_SYNCED,
                    sapSyncMessage: 'Rejected with generic article',
                    approvedBy: userId ? Number(userId) : null,
                    approvedAt: new Date()
                }
            });

            // Mirror variant rejections to 360article (fire-and-forget)
            void Promise.all(variantsToReject.map(v =>
                mirror360FlatUpdate(v.id, { approvalStatus: 'REJECTED', sapSyncStatus: 'NOT_SYNCED' })
            )).catch((err: any) => console.error('[mirror360] variant rejection mirror failed:', err?.message));

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

            const result = await prisma.extractionResultFlat.updateMany({
                where: { genericArticleId: id, isGeneric: false, variantColor: null },
                data: { variantColor: generic.colour, colour: generic.colour }
            });
            return res.json({ message: `Synced colour to ${result.count} variants`, count: result.count });
        } catch (err: any) {
            return res.status(500).json({ error: err.message });
        }
    }

    // Get all variants for a generic article
    static async getVariants(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const variants = await prisma.extractionResultFlat.findMany({
                where: { genericArticleId: id, isGeneric: false },
                orderBy: [{ variantColor: 'asc' }, { variantSize: 'asc' }],
                take: 5000,
            });
            return res.json({ data: variants });
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
            const allSyncedVariants = await prisma.extractionResultFlat.findMany({
                where: {
                    genericArticleId: id,
                    isGeneric: false,
                    sapSyncStatus: 'SYNCED',
                    sapArticleId: { not: null },
                },
                select: { id: true, imageUrl: true, variantColor: true, colour: true }
            });
            const needsRetroUpload = allSyncedVariants.filter(
                (v) => v.imageUrl && !storageService.extractApprovedKeyFromUrl(v.imageUrl)
            );
            if (needsRetroUpload.length > 0) {
                console.log(`[RETRY_VARIANTS] Retroactive image upload for ${needsRetroUpload.length} SYNCED variant(s)`);
                await Promise.allSettled(needsRetroUpload.map(async (v) => {
                    const colorCode = v.variantColor || v.colour || undefined;
                    try {
                        const upload = await storageService.uploadApprovedImageFromSourceUrl(
                            String(v.imageUrl),
                            genericBaseNum,
                            undefined,
                            colorCode ?? undefined,
                        );
                        await prisma.extractionResultFlat.update({
                            where: { id: v.id },
                            data: { imageUrl: upload.url },
                        });
                        console.log(`✅ [RETRY_VARIANTS] Retroactive image upload: ${upload.key}`);
                    } catch (imgErr: any) {
                        console.error(`❌ [RETRY_VARIANTS] Retroactive upload failed for ${v.id}:`, imgErr?.message);
                    }
                }));
            }

            // 3. Find variants that need (re)syncing to SAP
            const variants = await prisma.extractionResultFlat.findMany({
                where: {
                    genericArticleId: id,
                    isGeneric: false,
                    sapSyncStatus: { in: ['FAILED', 'NOT_SYNCED'] }
                }
            });

            // Also include PENDING variants — auto-approve them first
            const pendingVariants = await prisma.extractionResultFlat.findMany({
                where: {
                    genericArticleId: id,
                    isGeneric: false,
                    approvalStatus: 'PENDING'
                }
            });

            if (pendingVariants.length > 0) {
                const userId = (req as any).user?.id;
                await prisma.extractionResultFlat.updateMany({
                    where: { id: { in: pendingVariants.map(v => v.id) } },
                    data: {
                        approvalStatus: 'APPROVED',
                        approvedBy: userId ? Number(userId) : null,
                        approvedAt: new Date(),
                        sapSyncStatus: 'NOT_SYNCED'
                    }
                });
            }

            const allToSync = [
                ...variants,
                ...pendingVariants.filter(p => !variants.find(v => v.id === p.id))
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

            // 4. Build maps for syncVariantsToSapViaRfc
            const variantsByGenericId = new Map([[id, allToSync]]);
            const genericSapArticleMap = new Map([[id, generic.sapArticleId]]);

            // 5. Call the existing RFC function
            const results = await syncVariantsToSapViaRfc(variantsByGenericId, genericSapArticleMap);

            // 6. Persist results back to DB
            await Promise.allSettled(results.map(r => {
                const data: Record<string, unknown> = {
                    sapSyncStatus: r.success ? SapSyncStatus.SYNCED : SapSyncStatus.FAILED,
                    sapSyncMessage: r.message
                };
                if (r.sapArticleNumber) {
                    data.sapArticleId = r.sapArticleNumber;
                    data.articleNumber = r.sapArticleNumber;
                }
                if (r.success && r.fabricArticleNumber) {
                    data.fabricArticleNumber = r.fabricArticleNumber;
                }
                if (r.success && r.fabricArticleDescription) {
                    data.fabricArticleDescription = r.fabricArticleDescription;
                }
                return prisma.extractionResultFlat.update({ where: { id: r.id }, data });
            }));

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
                            await prisma.extractionResultFlat.update({
                                where: { id: r.id },
                                data: { imageUrl: upload.url },
                            });
                            console.log(`✅ [RETRY_VARIANTS] Variant image saved to article-master: ${upload.key}`);
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

    // Duplicate an existing article — creates a new PENDING copy with all fields copied
    static async duplicateItem(req: Request, res: Response) {
        try {
            const { id } = req.params;
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
            const { color, colors, sizes, colorImages } = req.body;
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
            let sizesOverride: string[] | undefined;
            if (Array.isArray(sizes) && sizes.length > 0) {
                const generic = await prisma.extractionResultFlat.findUnique({
                    where: { id }, select: { majorCategory: true },
                });
                const allowed = await getSizesForMajCat(generic?.majorCategory || '');
                const allowedUpper = new Set(allowed.map((s) => s.trim().toUpperCase()));
                const invalid = sizes
                    .map((s: string) => String(s).trim())
                    .filter((s: string) => s && !allowedUpper.has(s.toUpperCase()));
                if (invalid.length > 0) {
                    return res.status(422).json({
                        error: 'INVALID_SIZE_FOR_CATEGORY',
                        detail: `Size(s) not allowed for category '${generic?.majorCategory ?? ''}': ${invalid.join(', ')}.`,
                    });
                }
                sizesOverride = sizes.map((s: string) => String(s).trim()).filter(Boolean);
            }

            let totalCreated = 0;
            for (const c of colorList) {
                totalCreated += await addColorVariants(id, c, sizesOverride, imageByColor[c]);
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

    // Cached BOM grid map (loaded once from disk)
    private static bomGridMap: Record<string, Record<string, Record<string, string>>> | null = null;

    private static loadBomGridMap() {
        if (ApproverController.bomGridMap) return ApproverController.bomGridMap;
        try {
            const filePath = path.resolve(__dirname, '../data/majCatGridMap.json');
            ApproverController.bomGridMap = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error('[BomGrid] Failed to load majCatGridMap.json:', err);
            ApproverController.bomGridMap = {};
        }
        return ApproverController.bomGridMap!;
    }

    // GET /api/approver/sizes-for-majcat/:majCat
    // Returns active sizes array for the given major category (from maj_cat_sizes table)
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

    // GET /api/approver/bom-art-numbers/:majCat
    // Returns { [excelAttrName]: { [mvgrValue]: sapCd } } for the given major category
    static async getBomArtNumbers(req: Request, res: Response) {
        try {
            const { majCat } = req.params;
            const map = ApproverController.loadBomGridMap();
            const catData = map[majCat] || {};
            return res.json({ success: true, data: catData });
        } catch (err: any) {
            console.error('[BomGrid] getBomArtNumbers error:', err);
            return res.status(500).json({ success: false, error: 'Failed to load BOM art numbers' });
        }
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
     * GET /api/approver/vendor-search?q=<query>
     * Returns up to 15 vendor records matching the typed name (case-insensitive).
     * Requires at least 2 characters to avoid returning the full 8k list.
     */
    static async vendorSearch(req: Request, res: Response) {
        const q = String(req.query.q ?? '').trim();
        if (q.length < 2) {
            return res.json({ success: true, data: [] });
        }

        const results = await prisma.masterVendorDetail.findMany({
            where: {
                vendorName: { contains: q, mode: 'insensitive' },
            },
            select: {
                vendorCode: true,
                vendorName: true,
                vendorCity: true,
            },
            orderBy: { vendorName: 'asc' },
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

    static async searchFabricArticleData(req: Request, res: Response) {
        const q = String(req.query.q ?? '').trim();
        if (!q) return res.json({ results: [] });
        const results = await prisma.fabricArticleData.findMany({
            where: {
                OR: [
                    { fabricArticleNumber: { contains: q, mode: 'insensitive' } },
                    { fabricArticleDescription: { contains: q, mode: 'insensitive' } },
                ],
                NOT: { fabricArticleNumber: null },
            },
            select: {
                fabricArticleNumber: true,
                fabricArticleDescription: true,
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
            distinct: ['fabricArticleNumber'],
            take: 15,
            orderBy: { fabricArticleNumber: 'asc' },
        });
        return res.json({ results });
    }

    // Body Article No. search (Body & Construction card) — backed by body_article_data,
    // the admin-managed master table (see Admin.tsx "Body Article Data" upload card).
    // Partial queries return up to 10 matches; an exact Body Article Number match (if any)
    // is always included, even if it would otherwise fall outside the top 10.
    static async searchBodyArticleData(req: Request, res: Response) {
        const q = String(req.query.q ?? '').trim();
        if (!q) return res.json({ results: [] });

        const selectFields = {
            bodyArticleNumber: true,
            bodyArticleDescription: true,
            mCollarType: true, mCollarStyle: true,
            mNeckType: true, mNeckStyle: true,
            mPlacket: true, mBltType: true, mBltStyle: true,
            mSleevesMainStyle: true, mSleeveFold: true, mBtmFold: true,
            mNoOfPocket: true, mPocket: true, mExtraPocket: true,
            mFit: true, mBodyStyle: true, mLength: true, mSet: true,
            cmtpCost: true, cmpCost: true,
        } as const;

        const exact = await prisma.bodyArticleData.findFirst({
            where: { bodyArticleNumber: { equals: q, mode: 'insensitive' } },
            select: selectFields,
        });

        const partial = await prisma.bodyArticleData.findMany({
            where: {
                OR: [
                    { bodyArticleNumber: { contains: q, mode: 'insensitive' } },
                    { bodyArticleDescription: { contains: q, mode: 'insensitive' } },
                ],
                NOT: { bodyArticleNumber: null },
            },
            select: selectFields,
            distinct: ['bodyArticleNumber'],
            take: 10,
            orderBy: { bodyArticleNumber: 'asc' },
        });

        const seen = new Set<string>();
        const results: typeof partial = [];
        if (exact?.bodyArticleNumber) { results.push(exact); seen.add(exact.bodyArticleNumber); }
        for (const r of partial) {
            if (results.length >= 10) break;
            if (r.bodyArticleNumber && seen.has(r.bodyArticleNumber)) continue;
            results.push(r);
            if (r.bodyArticleNumber) seen.add(r.bodyArticleNumber);
        }

        return res.json({ results });
    }
}
