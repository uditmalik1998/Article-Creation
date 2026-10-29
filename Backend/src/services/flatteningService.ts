import { getMcCodeByMajorCategory, getDivisionByMajorCategory, getSubDivisionByMajorCategory, getHsnCodeByMcCode } from '../utils/mcCodeMapper';
import { prismaClient as prisma } from '../utils/prisma';
import { parseNumericValue } from '../utils/mrpCalculator';
import { buildArticleDescription, buildReferenceArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { getSegmentFromMaster } from './segmentMasterService';
import { normalizeVendorCode } from '../utils/vendorCode';

function getCurrentSeasonCode(): string {
    const month = new Date().getMonth() + 1;
    const yr = String(new Date().getFullYear()).slice(-2);
    if (month <= 3) return `SP${yr}`;
    if (month <= 6) return `S${yr}`;
    if (month <= 9) return `A${yr}`;
    return `W${yr}`;
}

export class FlatteningService {
    private extractNumericWeight(value: unknown): string | null {
        if (value === null || value === undefined) return null;
        const text = String(value).trim();
        if (!text) return null;
        const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
        return match ? match[1] : null;
    }

    /**
     * Build the flat-table row for an extraction job from its extracted
     * attribute values (passed in memory — they are no longer stored per
     * attribute in a separate table).
     */
    async flattenExtractionResults(
        jobId: string,
        entries: { attributeId: number; rawValue?: string | null; finalValue?: string | null }[],
    ): Promise<void> {
        const job = await prisma.extractionJob.findUnique({
            where: { id: jobId },
            include: {
                category: {
                    include: {
                        subDepartment: {
                            include: { department: true }
                        }
                    }
                },
                user: true
            }
        });

        if (!job) {
            console.warn(`Job ${jobId} not found, skipping flattening`);
            return;
        }

        const existingFlat = await prisma.extractionResultFlat.findUnique({
            where: { jobId },
            select: { vendorCode: true }
        });

        // Attribute id → key, to address the values by key below.
        const attrIds = [...new Set(entries.map((e) => e.attributeId))];
        const attrs = attrIds.length > 0
            ? await prisma.masterAttribute.findMany({ where: { id: { in: attrIds } }, select: { id: true, key: true } })
            : [];
        const keyById = new Map(attrs.map((a) => [a.id, a.key]));
        const results = entries
            .filter((e) => keyById.has(e.attributeId))
            .map((e) => ({ ...e, attribute: { key: keyById.get(e.attributeId)! } }));

        const flatData = await this.mapToFlatStructure({ ...job, results }, existingFlat?.vendorCode || null);

        // Upsert to flat table (create or update)
        const flatRecord = await prisma.extractionResultFlat.upsert({
            where: { jobId },
            create: flatData,
            update: flatData
        });

        console.log(`✅ Flattened extraction job ${jobId}`);
    }

    /**
     * Map extraction job to flat structure
     */
    private async mapToFlatStructure(job: any, existingVendorCode: string | null = null): Promise<any> {
        const resultsMap = new Map();

        // Build map of attribute key -> value
        job.results.forEach((result: any) => {
            const key = result.attribute.key.toLowerCase();
            resultsMap.set(key, result.finalValue || result.rawValue);
        });

        // Extract image name from URL
        // imageName = UUID-based filename for internal storage
        // articleNumber = original uploaded filename (stored in job.designNumber)
        let imageName = null;
        let articleNumber = null;

        if (job.imageUrl) {
            const fullFilename = job.imageUrl.split('/').pop()?.split('?')[0] || '';
            // Remove file extension
            const nameWithoutExt = fullFilename.replace(/\.[^/.]+$/, '');
            imageName = nameWithoutExt; // UUID for internal use
        }

        // articleNumber is assigned only after successful SAP sync — leave null here
        articleNumber = null;

        const parsedRate = parseNumericValue(
            resultsMap.get('rate')
            ?? resultsMap.get('price')
            ?? job.costPrice
        );
        const explicitMrp = parseNumericValue(resultsMap.get('mrp'));
        const finalMrp = (explicitMrp != null && explicitMrp > 1) ? explicitMrp : null;

        const rawMajorCategory = resultsMap.get('major_category') || job.category?.code;
        const mappedMcCode = getMcCodeByMajorCategory(rawMajorCategory);
        const majorCategory = mappedMcCode ? rawMajorCategory : null;
        const normalizedWeight = this.extractNumericWeight(
            resultsMap.get('m_fab_weight')
            || resultsMap.get('weight')
            || resultsMap.get('g_weight')
            || resultsMap.get('g-weight')
            || resultsMap.get('gweight')
        );

        const normalizedVendorCode = normalizeVendorCode(
            resultsMap.get('vendor_code') || resultsMap.get('vendor code') || existingVendorCode
        );

        return {
            jobId: job.id,

            // Essential Metadata
            imageName, // UUID-based filename for internal use
            imageUrl: job.imageUrl,
            sourceImageUrl: job.imageUrl || null, // clean image — approval overwrites imageUrl, not this
            articleNumber, // null until SAP sync assigns the real article number
            extractionStatus: job.status,
            aiModel: job.aiModel,
            avgConfidence: job.avgConfidence,
            processingTimeMs: job.processingTimeMs,
            totalAttributes: job.totalAttributes,
            extractedCount: job.extractedCount,
            inputTokens: job.inputTokens,
            outputTokens: job.outputTokens,
            totalTokens: job.tokensUsed || (job.inputTokens && job.outputTokens ? job.inputTokens + job.outputTokens : null),
            apiCost: job.apiCost,
            userId: job.userId,
            userName: job.user?.name,
            extractionDate: job.completedAt || job.createdAt,

            // All 41 Attributes
            majorCategory, // mc code list-valid major category (mc des) only
            mcCode: mappedMcCode,
            hsnTaxCode: mappedMcCode ? (getHsnCodeByMcCode(mappedMcCode)?.toString() ?? null) : null,
            vendorName: resultsMap.get('vendor_name'),
            designNumber: resultsMap.get('design_number'),
            // pptNumber intentionally NOT set from AI extraction — only SRM sync populates this
            rate: parsedRate,
            mrp: finalMrp,
            size: resultsMap.get('size'),
            yarn1: resultsMap.get('yarn_01'),
            yarn2: resultsMap.get('yarn_02'),
            fabricMainMvgr: resultsMap.get('fabric_main_mvgr'),
            weave: resultsMap.get('weave'),
            macroMvgr: resultsMap.get('macro_mvgr'),
            mainMvgr: resultsMap.get('main_mvgr'),
            mFab2: resultsMap.get('m_fab2'),
            composition: resultsMap.get('composition'),
            finish: resultsMap.get('finish'),
            gsm: resultsMap.get('gsm') || resultsMap.get('gram_per_square_meter'),
            shade: resultsMap.get('shade'),
            weight: normalizedWeight,
            lycra: resultsMap.get('lycra_non_lycra') || resultsMap.get('lycra_non\nlycra'),
            neck: resultsMap.get('neck'),
            neckDetails: resultsMap.get('neck_details') || resultsMap.get('neck_detail'),
            collar: resultsMap.get('collar'),
            collarStyle: resultsMap.get('collar_style'),
            placket: resultsMap.get('placket'),
            sleeve: resultsMap.get('sleeve'),
            sleeveFold: resultsMap.get('sleeve_fold'),
            bottomFold: resultsMap.get('bottom_fold'),
            frontOpenStyle: resultsMap.get('front_open_style'),
            noOfPocket: resultsMap.get('no_of_pocket'),
            pocketType: resultsMap.get('pocket_type'),
            extraPocket: resultsMap.get('extra_pocket'),
            fit: resultsMap.get('fit'),
            pattern: resultsMap.get('pattern'),
            length: resultsMap.get('length'),
            colour: resultsMap.get('colour') || resultsMap.get('color'),
            drawcord: resultsMap.get('drawcord'),
            dcShape: resultsMap.get('dc_shape'),
            button: resultsMap.get('button'),
            btnColour: resultsMap.get('btn_colour'),
            zipper: resultsMap.get('zipper'),
            zipColour: resultsMap.get('zip_colour'),
            printType: resultsMap.get('print_type'),
            printStyle: resultsMap.get('print_style'),
            printPlacement: resultsMap.get('print_placement'),
            patches: resultsMap.get('patches'),
            patchesType: resultsMap.get('patches_type') || resultsMap.get('patch_type'),
            embroidery: resultsMap.get('embroidery'),
            embroideryType: resultsMap.get('embroidery_type'),
            embPlacement: resultsMap.get('emb_placement'),
            htrfType: resultsMap.get('htrf_type'),
            htrfStyle: resultsMap.get('htrf_style'),
            wash: resultsMap.get('wash'),
            ageGroup: resultsMap.get('age_group'),
            articleFashionType: resultsMap.get('article_fashion_type') || resultsMap.get('fashion_grade'),
            articleDimension: resultsMap.get('article_dimension'),
            fatherBelt: resultsMap.get('father_belt'),
            childBelt: resultsMap.get('child_belt') || resultsMap.get('child_belt_detail'),
            vendorCode: normalizedVendorCode,

            // Hierarchy Mapping
            // Priority: watcher/user-provided > user-selected (resultsMap) > JSON lookup by majorCategory > category hierarchy
            // NOTE: resultsMap.get('division') holds the user's selected division (e.g. 'LADIES') stored
            // as an extraction attribute during the simplified flow. It must take priority over
            // getDivisionByMajorCategory() which would derive MENS from a major category like MW_TEES_FS
            // even when the user explicitly chose LADIES.
            division: (job.watcherDivision as string | null | undefined)
              || (job.division as string | null | undefined)
              || resultsMap.get('division')
              || getDivisionByMajorCategory(rawMajorCategory)
              || job.category?.subDepartment?.department?.name
              || null,
            // Priority: watcher/user-provided > user-selected (resultsMap) > JSON lookup by majorCategory > category hierarchy
            subDivision: (job.watcherSubDivision as string | null | undefined)
              || (job.subDivision as string | null | undefined)
              || resultsMap.get('sub_division')
              || getSubDivisionByMajorCategory(rawMajorCategory)
              || job.category?.subDepartment?.code
              || null,
            referenceArticleNumber: resultsMap.get('reference_article_number') || null,
            // Built like ARTICLE DESC but from a different attribute sequence:
            // M_FAB_MAIN_MVGR_2 → M_WEAVE_02 → M_BLT_TYPE → M_BLT_STYLE →
            // M_FIT → M_BODY_STYLE → M_PRINT_PLACEMENT → M_WASH.
            // Falls back to any extracted reference description when no attributes are present.
            referenceArticleDescription: buildReferenceArticleDescription({
                fabricMainMvgr: resultsMap.get('fabric_main_mvgr'),
                mFab2:          resultsMap.get('m_fab2'),
                fatherBelt:     resultsMap.get('father_belt'),
                childBelt:      resultsMap.get('child_belt') || resultsMap.get('child_belt_detail'),
                fit:            resultsMap.get('fit'),
                bodyStyle:      resultsMap.get('pattern'),
                printPlacement: resultsMap.get('print_placement'),
                wash:           resultsMap.get('wash'),
            }, 40) || resultsMap.get('reference_article_description') || null,

            // Auto-populated business fields
            year: String(new Date().getFullYear()),
            season: getCurrentSeasonCode(),
            segment: mappedMcCode ? ((await getSegmentFromMaster(rawMajorCategory, finalMrp)) ?? null) : null,
            articleDescription: buildArticleDescription({
                yarn1:          resultsMap.get('yarn_01'),
                weave:          resultsMap.get('weave'),
                mFab2:          resultsMap.get('m_fab2'),
                fabricMainMvgr: resultsMap.get('fabric_main_mvgr'),
                collar:         resultsMap.get('collar'),
                collarStyle:    resultsMap.get('collar_style'),
                neckDetails:    resultsMap.get('neck_details') || resultsMap.get('neck_detail'),
                neck:           resultsMap.get('neck'),
                fatherBelt:     resultsMap.get('father_belt'),
                childBelt:      resultsMap.get('child_belt') || resultsMap.get('child_belt_detail'),
                noOfPocket:     resultsMap.get('no_of_pocket'),
                pattern:        resultsMap.get('pattern'),
                fit:            resultsMap.get('fit'),
                wash:           resultsMap.get('wash'),
            }, 40, {
                excludeFields: await getExcludedDescriptionFields(rawMajorCategory) as any,
            }),
            fashionGrid: resultsMap.get('fashion_grid') || resultsMap.get('fashiongrid') || null,
            articleType: resultsMap.get('article_type') || resultsMap.get('articletype') || null,
            fabVdr: resultsMap.get('fab_vdr') || null,
        };
    }

}

export const flatteningService = new FlatteningService();
