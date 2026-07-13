import { Request, Response, NextFunction } from 'express';
import { prismaClient as prisma } from '../utils/prisma';
import { getHsnCodeByMcCode, getMcCodeByMajorCategory } from '../utils/mcCodeMapper';
import { parseNumericValue } from '../utils/mrpCalculator';
import { hasVendorCode, isValidVendorCode, normalizeVendorCode } from '../utils/vendorCode';
import { mirror360FlatUpdate } from '../utils/mirror360Flat';

export class FlatExtractionController {
    private attributeKeyToFieldMap: Record<string, string> = {
        division: 'division',
        sub_division: 'subDivision',
        subdivision: 'subDivision',
        major_category: 'majorCategory',
        majorcategory: 'majorCategory',
        vendor_name: 'vendorName',
        design_number: 'designNumber',
        ppt_number: 'pptNumber',
        rate: 'rate',
        size: 'size',
        yarn_01: 'yarn1',
        yarn1: 'yarn1',
        yarn_02: 'yarn2',
        yarn2: 'yarn2',
        fabric_main_mvgr: 'fabricMainMvgr',
        macro_mvgr: 'macroMvgr',
        macromvgr: 'macroMvgr',
        main_mvgr: 'mainMvgr',
        mainmvgr: 'mainMvgr',
        m_fab2: 'mFab2',
        mfab2: 'mFab2',
        vendor_code: 'vendorCode',
        vendorcode: 'vendorCode',
        weave: 'weave',
        composition: 'composition',
        finish: 'finish',
        gram_per_square_meter: 'gsm',
        gsm: 'gsm',
        shade: 'shade',
        weight: 'weight',
        g_weight: 'weight',
        gweight: 'weight',
        'g-weight': 'weight',
        lycra_non_lycra: 'lycra',
        'lycra_non\nlycra': 'lycra',
        lycra: 'lycra',
        neck: 'neck',
        neck_detail: 'neckDetails',
        neck_details: 'neckDetails',
        collar: 'collar',
        placket: 'placket',
        sleeve: 'sleeve',
        bottom_fold: 'bottomFold',
        front_open_style: 'frontOpenStyle',
        pocket_type: 'pocketType',
        fit: 'fit',
        pattern: 'pattern',
        body_style: 'pattern',
        bodystyle: 'pattern',
        length: 'length',
        colour: 'colour',
        color: 'colour',
        drawcord: 'drawcord',
        button: 'button',
        zipper: 'zipper',
        zip_colour: 'zipColour',
        print_type: 'printType',
        print_style: 'printStyle',
        print_placement: 'printPlacement',
        patches: 'patches',
        patch_type: 'patchesType',
        patches_type: 'patchesType',
        embroidery: 'embroidery',
        embroidery_type: 'embroideryType',
        wash: 'wash',
        father_belt: 'fatherBelt',
        child_belt: 'childBelt',
        child_belt_detail: 'childBelt',
        reference_article_number: 'referenceArticleNumber',
        reference_article_description: 'referenceArticleDescription',
        mrp: 'mrp',
        mc_code: 'mcCode',
        mccode: 'mcCode',
        segment: 'segment',
        season: 'season',
        hsn_tax_code: 'hsnTaxCode',
        hsntaxcode: 'hsnTaxCode',
        article_description: 'articleDescription',
        articledescription: 'articleDescription',
        fashion_grid: 'fashionGrid',
        fashiongrid: 'fashionGrid',
        year: 'year',
        article_type: 'articleType',
        articletype: 'articleType',
        imp_atrbt_2: 'impAtrbt2',
        impatrbt2: 'impAtrbt2',
        imp_atrbt2: 'impAtrbt2',
        // Garment detail fields
        collar_style: 'collarStyle',
        collarstyle: 'collarStyle',
        sleeve_fold: 'sleeveFold',
        sleevefold: 'sleeveFold',
        no_of_pocket: 'noOfPocket',
        noofpocket: 'noOfPocket',
        extra_pocket: 'extraPocket',
        extrapocket: 'extraPocket',
        dc_shape: 'dcShape',
        dcshape: 'dcShape',
        btn_colour: 'btnColour',
        btncoulour: 'btnColour',
        btncolour: 'btnColour',
        // Fabric detail fields
        f_count: 'fCount',
        fcount: 'fCount',
        f_construction: 'fConstruction',
        fconstruction: 'fConstruction',
        f_ounce: 'fOunce',
        founce: 'fOunce',
        f_width: 'fWidth',
        fwidth: 'fWidth',
        fab_div: 'fabDiv',
        fabdiv: 'fabDiv',
        // HTRF fields
        htrf_type: 'htrfType',
        htrftype: 'htrfType',
        htrf_style: 'htrfStyle',
        htrfstyle: 'htrfStyle',
        // Embroidery placement
        emb_placement: 'embPlacement',
        embplacement: 'embPlacement',
        // Business fields
        age_group: 'ageGroup',
        agegroup: 'ageGroup',
        article_fashion_type: 'articleFashionType',
        articlefashiontype: 'articleFashionType',
        article_dimension: 'articleDimension',
        articledimension: 'articleDimension',
    };

    private normalizeAttributeKey(key: string): string {
        return String(key || '').trim().toLowerCase();
    }

    private normalizeRole(role: unknown): string {
        return String(role || '').trim().toUpperCase();
    }

    private parseSubDivisions(value: unknown): string[] {
        if (value === null || value === undefined) return [];
        const tokens = String(value)
            .split(/[;,|]+/)
            .map((item) => item.trim())
            .filter(Boolean);
        return Array.from(new Set(tokens));
    }

    private parseDivisions(value: unknown): string[] {
        if (value === null || value === undefined) return [];
        const tokens = String(value)
            .split(/[;,|]+/)
            .map((item) => item.trim())
            .filter(Boolean);
        return Array.from(new Set(tokens));
    }

    private extractNumericWeight(input: unknown): string | null {
        if (input === null || input === undefined) return null;
        const text = String(input).trim();
        if (!text) return null;
        const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : null;
    }

    private isCreatorLike(role: string): boolean {
        const normalizedRole = this.normalizeRole(role);
        return normalizedRole === 'CREATOR' || normalizedRole === 'PO_COMMITTEE';
    }

    /**
     * Get all extraction jobs from flat table (fast query)
     */
    getAllFlat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user?.id;
            const role = this.normalizeRole(user?.role);
            const division = user?.division;
            const subDivision = user?.subDivision;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
                return;
            }

            const where: any = {};

            // RBAC Filtering Logic (creator self-only, others as per scope)
            if (role === 'CREATOR' || role === 'PO_COMMITTEE') {
                // Creators and PO Committee only see their own extractions
                where.userId = userId;
            } else if (role === 'APPROVER') {
                // Approvers see extractions within their assigned scope
                const divisionList = this.parseDivisions(division);
                if (divisionList.length === 1) {
                    where.division = divisionList[0];
                } else if (divisionList.length > 1) {
                    where.division = { in: divisionList };
                }
                const subDivisionList = this.parseSubDivisions(subDivision);
                if (subDivisionList.length === 1) {
                    where.subDivision = subDivisionList[0];
                } else if (subDivisionList.length > 1) {
                    where.subDivision = { in: subDivisionList };
                }
            } else if (role === 'CATEGORY_HEAD') {
                // Category heads see all extractions within their assigned division
                const divisionList = this.parseDivisions(division);
                if (divisionList.length === 1) {
                    where.division = divisionList[0];
                } else if (divisionList.length > 1) {
                    where.division = { in: divisionList };
                }
            } else if (role === 'ADMIN') {
                // Admins see all - no filters applied
            } else {
                // Default to self-only for unknown roles (security first)
                where.userId = userId;
            }

            // Only show generic (original) articles — not size/color variant copies
            where.isGeneric = true;

            const flatResults = await prisma.extractionResultFlat.findMany({
                where,
                orderBy: [
                    { createdAt: 'desc' },
                    { id: 'desc' }
                ],
                take: 500,
            });

            res.json({
                success: true,
                data: {
                    jobs: flatResults,
                    total: flatResults.length
                }
            });
        } catch (error) {
            console.error('Error fetching flat extraction results:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch extraction results'
            });
        }
    };

    /**
     * Get single extraction job from flat table
     */
    getOneFlat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { id } = req.params;

            const flatResult = await prisma.extractionResultFlat.findUnique({
                where: { jobId: id }
            });

            if (!flatResult) {
                res.status(404).json({
                    success: false,
                    error: 'Extraction job not found'
                });
                return;
            }

            res.json({
                success: true,
                data: flatResult
            });
        } catch (error) {
            console.error('Error fetching flat extraction result:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch extraction result'
            });
        }
    };

    /**
     * Update one editable attribute in flat table row by jobId
     */
    updateFlatAttributeByJobId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user?.id;
            const role = this.normalizeRole(user?.role);
            const division = user?.division;
            const subDivision = user?.subDivision;
            const { jobId } = req.params;
            const { attributeKey, value } = req.body || {};

            if (!userId) {
                res.status(401).json({ success: false, error: 'Unauthorized' });
                return;
            }

            if (!jobId) {
                res.status(400).json({ success: false, error: 'jobId is required' });
                return;
            }

            if (!attributeKey || typeof attributeKey !== 'string') {
                res.status(400).json({ success: false, error: 'attributeKey is required' });
                return;
            }

            const normalizedKey = this.normalizeAttributeKey(attributeKey);
            const fieldName = this.attributeKeyToFieldMap[normalizedKey];

            if (!fieldName) {
                res.status(400).json({ success: false, error: `Unsupported attributeKey: ${attributeKey}` });
                return;
            }

            const existing = await prisma.extractionResultFlat.findUnique({
                where: { jobId },
                select: {
                    id: true,
                    userId: true,
                    division: true,
                    subDivision: true,
                    approvalStatus: true,
                    sapSyncStatus: true,
                    majorCategory: true,
                    rate: true,
                    mrp: true
                }
            });

            if (!existing) {
                res.status(404).json({ success: false, error: 'Extraction row not found' });
                return;
            }

            const isSapLocked = existing.approvalStatus === 'APPROVED' && existing.sapSyncStatus === 'SYNCED';

            // Admin can override the SAP lock
            if (isSapLocked && role !== 'ADMIN') {
                res.status(403).json({ success: false, error: 'Cannot update an approved item.' });
                return;
            }

            if (this.isCreatorLike(role)) {
                if (!existing.userId || Number(existing.userId) !== Number(userId)) {
                    res.status(403).json({ success: false, error: 'Access denied: Not your extraction.' });
                    return;
                }
            } else if (role === 'APPROVER') {
                if (division && existing.division) {
                    const userDivList = this.parseDivisions(division).map((d) => d.toLowerCase());
                    if (userDivList.length > 0 && !userDivList.includes(String(existing.division).toLowerCase())) {
                        res.status(403).json({ success: false, error: 'Access denied: Division mismatch.' });
                        return;
                    }
                }
                const subDivisionList = this.parseSubDivisions(subDivision).map((item) => item.toLowerCase());
                if (subDivisionList.length > 0 && existing.subDivision) {
                    const existingSubDivision = String(existing.subDivision).toLowerCase();
                    if (!subDivisionList.includes(existingSubDivision)) {
                        res.status(403).json({ success: false, error: 'Access denied: Sub-Division mismatch.' });
                        return;
                    }
                }
            } else if (role === 'CATEGORY_HEAD') {
                if (division && existing.division) {
                    const userDivList = this.parseDivisions(division).map((d) => d.toLowerCase());
                    if (userDivList.length > 0 && !userDivList.includes(String(existing.division).toLowerCase())) {
                        res.status(403).json({ success: false, error: 'Access denied: Division mismatch.' });
                        return;
                    }
                }
            }

            const toNullableString = (input: unknown): string | null => {
                if (input === null || input === undefined) return null;
                const text = String(input).trim();
                return text === '' ? null : text;
            };

            const data: Record<string, unknown> = {};

            if (fieldName === 'mrp') {
                data.mrp = parseNumericValue(value);
            } else if (fieldName === 'rate') {
                data.rate = parseNumericValue(value);
            } else if (fieldName === 'majorCategory') {
                const majorCategoryText = toNullableString(value);

                if (majorCategoryText) {
                    const mappedMcCode = getMcCodeByMajorCategory(majorCategoryText);
                    if (!mappedMcCode) {
                        res.status(400).json({
                            success: false,
                            error: `Invalid majorCategory '${majorCategoryText}'. Please use values from mc code list (mc des).`
                        });
                        return;
                    }

                    data.majorCategory = majorCategoryText;
                    data.mcCode = mappedMcCode;
                    data.hsnTaxCode = getHsnCodeByMcCode(mappedMcCode) || null;
                } else {
                    data.majorCategory = null;
                    data.mcCode = null;
                    data.hsnTaxCode = null;
                }
            } else if (fieldName === 'vendorCode') {
                if (!hasVendorCode(value) || !isValidVendorCode(value)) {
                    res.status(400).json({ success: false, error: 'Vendor Code is required and must be exactly 6 digits' });
                    return;
                }

                data.vendorCode = normalizeVendorCode(value);
            } else {
                data[fieldName] = fieldName === 'weight'
                    ? this.extractNumericWeight(value)
                    : toNullableString(value);
            }

            const updated = await prisma.extractionResultFlat.update({
                where: { id: existing.id },
                data
            });

            // Mirror to 360article.article_360_flat (fire-and-forget)
            void mirror360FlatUpdate(existing.id, data);

            res.json({
                success: true,
                data: updated
            });
        } catch (error) {
            console.error('Error updating extraction flat attribute:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save extraction changes'
            });
        }
    };

    /**
     * Mark a flat extraction row as creator-reviewed.
     * Only reviewed rows (extractionStatus=COMPLETED) are visible in Products/Approver dashboards.
     */
    markFlatReviewCompleteByJobId = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user?.id;
            const role = this.normalizeRole(user?.role);
            const division = user?.division;
            const subDivision = user?.subDivision;
            const { jobId } = req.params;
            const { checked } = req.body || {};

            if (!userId) {
                res.status(401).json({ success: false, error: 'Unauthorized' });
                return;
            }

            if (!jobId) {
                res.status(400).json({ success: false, error: 'jobId is required' });
                return;
            }

            if (typeof checked !== 'boolean') {
                res.status(400).json({ success: false, error: 'checked must be a boolean' });
                return;
            }

            const existing = await prisma.extractionResultFlat.findUnique({
                where: { jobId },
                select: {
                    id: true,
                    userId: true,
                    division: true,
                    subDivision: true,
                    approvalStatus: true
                }
            });

            if (!existing) {
                res.status(404).json({ success: false, error: 'Extraction row not found' });
                return;
            }

            if (existing.approvalStatus === 'APPROVED') {
                res.status(403).json({ success: false, error: 'Cannot mark an approved item.' });
                return;
            }

            if (this.isCreatorLike(role)) {
                if (!existing.userId || Number(existing.userId) !== Number(userId)) {
                    res.status(403).json({ success: false, error: 'Access denied: Not your extraction.' });
                    return;
                }
            } else if (role === 'APPROVER') {
                if (division && existing.division) {
                    const userDivList = this.parseDivisions(division).map((d) => d.toLowerCase());
                    if (userDivList.length > 0 && !userDivList.includes(String(existing.division).toLowerCase())) {
                        res.status(403).json({ success: false, error: 'Access denied: Division mismatch.' });
                        return;
                    }
                }
                const subDivisionList = this.parseSubDivisions(subDivision).map((item) => item.toLowerCase());
                if (subDivisionList.length > 0 && existing.subDivision) {
                    const existingSubDivision = String(existing.subDivision).toLowerCase();
                    if (!subDivisionList.includes(existingSubDivision)) {
                        res.status(403).json({ success: false, error: 'Access denied: Sub-Division mismatch.' });
                        return;
                    }
                }
            } else if (role === 'CATEGORY_HEAD') {
                if (division && existing.division) {
                    const userDivList = this.parseDivisions(division).map((d) => d.toLowerCase());
                    if (userDivList.length > 0 && !userDivList.includes(String(existing.division).toLowerCase())) {
                        res.status(403).json({ success: false, error: 'Access denied: Division mismatch.' });
                        return;
                    }
                }
            }

            const updated = await prisma.extractionResultFlat.update({
                where: { id: existing.id },
                data: {
                    extractionStatus: checked ? 'COMPLETED' : 'REVIEW_PENDING'
                }
            });

            res.json({
                success: true,
                data: updated
            });
        } catch (error) {
            console.error('Error marking extraction review completion:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update review completion'
            });
        }
    };
}

export const flatExtractionController = new FlatExtractionController();
