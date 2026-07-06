import { getMcCodeByMajorCategory, getDivisionByMajorCategory, getSubDivisionByMajorCategory, getHsnCodeByMcCode } from '../utils/mcCodeMapper';
import { prismaClient as prisma } from '../utils/prisma';
import { parseNumericValue } from '../utils/mrpCalculator';
import { mvgrMappingService } from './mvgrMappingService';
import { buildArticleDescription, buildReferenceArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';
import { normalizeVendorCode } from '../utils/vendorCode';
import { upsert360ArticleFlatRow } from '../utils/mirror360Flat';

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
     * Flatten extraction job results into the flat table for fast querying
     */
    async flattenExtractionResults(jobId: string): Promise<void> {
        const job = await prisma.extractionJob.findUnique({
            where: { id: jobId },
            include: {
                results: { include: { attribute: true } },
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

        const flatData = await this.mapToFlatStructure(job, existingFlat?.vendorCode || null);

        // Upsert to flat table (create or update)
        const flatRecord = await prisma.extractionResultFlat.upsert({
            where: { jobId },
            create: flatData,
            update: flatData
        });

        // Mirror to 360article.article_360_flat (fire-and-forget)
        void upsert360ArticleFlatRow(flatRecord.id, { ...flatData, jobId });

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
            resultsMap.get('weight')
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
            macroMvgrFullForm: mvgrMappingService.getMacroMvgrFullForm(resultsMap.get('macro_mvgr')),
            mainMvgr: resultsMap.get('main_mvgr'),
            mainMvgrFullForm: mvgrMappingService.getMainMvgrFullForm(resultsMap.get('main_mvgr')),
            mFab2: resultsMap.get('m_fab2'),
            mFab2FullForm: mvgrMappingService.getWeave2FullForm(resultsMap.get('m_fab2')),
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
            segment: mappedMcCode ? (getSegmentByCategoryAndMrp(rawMajorCategory, finalMrp) ?? null) : null,
            articleDescription: buildArticleDescription({
                fabDiv:         resultsMap.get('fab_div'),
                yarn1:          resultsMap.get('yarn_01'),
                fabricMainMvgr: resultsMap.get('fabric_main_mvgr'),
                weave:          resultsMap.get('weave'),
                mFab2:          resultsMap.get('m_fab2'),
                neckDetails:    resultsMap.get('neck_details') || resultsMap.get('neck_detail'),
                collarStyle:    resultsMap.get('collar_style'),
                fatherBelt:     resultsMap.get('father_belt'),
                fit:            resultsMap.get('fit'),
                pattern:        resultsMap.get('pattern'),
            }, 40, {
                excludeFields: await getExcludedDescriptionFields(rawMajorCategory) as any,
            }),
            fashionGrid: resultsMap.get('fashion_grid') || resultsMap.get('fashiongrid') || null,
            articleType: resultsMap.get('article_type') || resultsMap.get('articletype') || null,
            fabVdr: resultsMap.get('fab_vdr') || null,
        };
    }

    /**
     * Upsert a row into 360article.article_360_flat, mirroring the public flat table.
     * Uses raw SQL because the Prisma client is not yet regenerated for the 360article schema.
     */
    private async upsertTo360ArticleFlat(d: any): Promise<void> {
        const str = (v: unknown) => (v == null ? null : String(v));
        const num = (v: unknown) => (v == null ? null : Number(v));

        await prisma.$executeRawUnsafe(`
            INSERT INTO "360article"."article_360_flat" (
                id, job_id,
                image_name, image_url,
                division, sub_division, major_category,
                design_number, vendor_name, vendor_code,
                reference_article_number, reference_article_description,
                article_number, sap_article_id, mc_code,
                rate, mrp, imp_atrbt_2,
                macro_mvgr, yarn_1, main_mvgr, fabric_main_mvgr,
                weave, m_fab2, composition,
                f_count, f_construction, lycra, finish, gsm,
                f_ounce, f_width,
                collar, collar_style, neck, neck_details, placket,
                father_belt, sleeve, sleeve_fold, bottom_fold,
                no_of_pocket, pocket_type, extra_pocket,
                fit, body_style, length,
                drawcord, dc_shape, button, btn_colour,
                zipper, zip_colour, patches, patches_type,
                print_type, print_style, print_placement,
                embroidery, embroidery_type, wash,
                extraction_status, approval_status, sap_sync_status,
                user_id, user_name, user_email,
                created_at, updated_at
            ) VALUES (
                gen_random_uuid()::text, $1,
                $2, $3,
                $4, $5, $6,
                $7, $8, $9,
                $10, $11,
                $12, $13, $14,
                $15, $16, $17,
                $18, $19, $20, $21,
                $22, $23, $24,
                $25, $26, $27, $28, $29,
                $30, $31,
                $32, $33, $34, $35, $36,
                $37, $38, $39, $40,
                $41, $42, $43,
                $44, $45, $46,
                $47, $48, $49, $50,
                $51, $52, $53, $54,
                $55, $56, $57,
                $58, $59, $60,
                $61, $62, $63,
                $64, $65, $66,
                now(), now()
            )
            ON CONFLICT (job_id) DO UPDATE SET
                image_name                    = EXCLUDED.image_name,
                image_url                     = EXCLUDED.image_url,
                division                      = EXCLUDED.division,
                sub_division                  = EXCLUDED.sub_division,
                major_category                = EXCLUDED.major_category,
                design_number                 = EXCLUDED.design_number,
                vendor_name                   = EXCLUDED.vendor_name,
                vendor_code                   = EXCLUDED.vendor_code,
                reference_article_number      = EXCLUDED.reference_article_number,
                reference_article_description = EXCLUDED.reference_article_description,
                article_number                = EXCLUDED.article_number,
                mc_code                       = EXCLUDED.mc_code,
                rate                          = EXCLUDED.rate,
                mrp                           = EXCLUDED.mrp,
                macro_mvgr                    = EXCLUDED.macro_mvgr,
                yarn_1                        = EXCLUDED.yarn_1,
                main_mvgr                     = EXCLUDED.main_mvgr,
                fabric_main_mvgr              = EXCLUDED.fabric_main_mvgr,
                weave                         = EXCLUDED.weave,
                m_fab2                        = EXCLUDED.m_fab2,
                composition                   = EXCLUDED.composition,
                lycra                         = EXCLUDED.lycra,
                finish                        = EXCLUDED.finish,
                gsm                           = EXCLUDED.gsm,
                collar                        = EXCLUDED.collar,
                neck                          = EXCLUDED.neck,
                neck_details                  = EXCLUDED.neck_details,
                placket                       = EXCLUDED.placket,
                father_belt                   = EXCLUDED.father_belt,
                sleeve                        = EXCLUDED.sleeve,
                bottom_fold                   = EXCLUDED.bottom_fold,
                pocket_type                   = EXCLUDED.pocket_type,
                fit                           = EXCLUDED.fit,
                body_style                    = EXCLUDED.body_style,
                length                        = EXCLUDED.length,
                drawcord                      = EXCLUDED.drawcord,
                button                        = EXCLUDED.button,
                zipper                        = EXCLUDED.zipper,
                zip_colour                    = EXCLUDED.zip_colour,
                patches                       = EXCLUDED.patches,
                patches_type                  = EXCLUDED.patches_type,
                print_type                    = EXCLUDED.print_type,
                print_style                   = EXCLUDED.print_style,
                print_placement               = EXCLUDED.print_placement,
                embroidery                    = EXCLUDED.embroidery,
                embroidery_type               = EXCLUDED.embroidery_type,
                wash                          = EXCLUDED.wash,
                extraction_status             = EXCLUDED.extraction_status,
                user_id                       = EXCLUDED.user_id,
                user_name                     = EXCLUDED.user_name,
                user_email                    = EXCLUDED.user_email,
                updated_at                    = now()
        `,
            // $1–$14: identity + header
            str(d.jobId),
            str(d.imageName), str(d.imageUrl),
            str(d.division), str(d.subDivision), str(d.majorCategory),
            str(d.designNumber), str(d.vendorName), str(d.vendorCode),
            str(d.referenceArticleNumber), str(d.referenceArticleDescription),
            str(d.articleNumber), str(d.sapArticleId ?? null), str(d.mcCode),
            // $15–$17: BOM
            num(d.rate), num(d.mrp), null,          // imp_atrbt_2 — filled manually
            // $18–$24: FAB part 1
            str(d.macroMvgr), str(d.yarn1), str(d.mainMvgr), str(d.fabricMainMvgr),
            str(d.weave), str(d.mFab2), str(d.composition),
            // $25–$31: FAB part 2 (new fields null until manually set)
            null, null,                              // f_count, f_construction
            str(d.lycra), str(d.finish), str(d.gsm),
            null, null,                              // f_ounce, f_width
            // $32–$40: BODY part 1
            str(d.collar), null,                     // collar, collar_style
            str(d.neck), str(d.neckDetails), str(d.placket),
            str(d.fatherBelt), str(d.sleeve), null, str(d.bottomFold), // sleeve_fold null
            // $41–$46: BODY part 2
            null, str(d.pocketType), null,           // no_of_pocket, extra_pocket
            str(d.fit), str(d.pattern), str(d.length),
            // $47–$54: VA ACC
            str(d.drawcord), null,                   // dc_shape null
            str(d.button), null,                     // btn_colour null
            str(d.zipper), str(d.zipColour), str(d.patches), str(d.patchesType),
            // $55–$60: VA PRCS
            str(d.printType), str(d.printStyle), str(d.printPlacement),
            str(d.embroidery), str(d.embroideryType), str(d.wash),
            // $61–$66: status + audit
            str(d.extractionStatus), 'PENDING', 'NOT_SYNCED',
            d.userId ?? null, str(d.userName), str(d.userEmail ?? null),
            // created_at/updated_at via now()
        );
    }

    /**
     * Batch flatten multiple extraction jobs
     */
    async flattenMultipleJobs(jobIds: string[]): Promise<void> {
        console.log(`🔄 Flattening ${jobIds.length} extraction jobs...`);

        let successCount = 0;
        let errorCount = 0;

        for (const jobId of jobIds) {
            try {
                await this.flattenExtractionResults(jobId);
                successCount++;
            } catch (error) {
                console.error(`❌ Error flattening job ${jobId}:`, error);
                errorCount++;
            }
        }

        console.log(`\n📊 Flattening Summary:`);
        console.log(`   ✅ Success: ${successCount}`);
        console.log(`   ❌ Errors: ${errorCount}`);
    }
}

export const flatteningService = new FlatteningService();
