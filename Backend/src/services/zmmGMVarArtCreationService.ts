/**
 * zmmGMVarArtCreationService.ts
 *
 * Sends GM colour × size variants (gm_variants_article_data) to SAP with the
 * same RFC as FG variants — ZMM_VAR_ART_CRT_V8 via syncVariantsToSapViaRfc.
 * GENERIC_ARTICLE is the GM generic's SAP number (gm_article_data.gm_article_number,
 * set by ZMM_ART_CRT_V3 on submit). Used after GM submit and by "Retry Variants".
 */

import { prismaClient as prisma } from '../utils/prisma';
import { syncVariantsToSapViaRfc } from './zmmVarArtCreationService';
import { storageService } from './storageService';

export interface GmVariantSyncSummary {
    synced: number;
    failed: number;
    skipped: string[]; // generic ids with no SAP number yet
}

/**
 * Pushes every variant without an article number for the given GM generics.
 * PENDING variants are approved first (same as FG retry). Generics not yet
 * created in SAP are skipped.
 */
export async function syncGmVariantsToSap(genericIds: string[], approvedBy?: number | null): Promise<GmVariantSyncSummary> {
    const summary: GmVariantSyncSummary = { synced: 0, failed: 0, skipped: [] };
    if (genericIds.length === 0) return summary;

    const generics = await prisma.gmArticleData.findMany({
        where: { id: { in: genericIds } },
        select: { id: true, gmArticleNumber: true },
    });

    const variantsByGenericId = new Map<string, any[]>();
    const genericSapArticleMap = new Map<string, string>();

    for (const g of generics) {
        const sapNum = (g.gmArticleNumber ?? '').trim();
        if (!sapNum) {
            summary.skipped.push(g.id);
            continue;
        }
        const variants = await prisma.gmVariantArticleData.findMany({
            where: { genericArticleId: g.id, variantArticleNumber: null },
            orderBy: [{ variantColor: 'asc' }, { createdAt: 'asc' }],
        });
        if (variants.length === 0) continue;

        const pendingIds = variants.filter((v) => v.approvalStatus === 'PENDING').map((v) => v.id);
        if (pendingIds.length > 0) {
            await prisma.gmVariantArticleData.updateMany({
                where: { id: { in: pendingIds } },
                data: { approvalStatus: 'APPROVED', approvedAt: new Date(), approvedBy: approvedBy ?? null },
            });
        }
        // Variants may have been added before the generic had its SAP number.
        await prisma.gmVariantArticleData.updateMany({
            where: { genericArticleId: g.id, NOT: { genericArticleNumber: sapNum } },
            data: { genericArticleNumber: sapNum },
        });

        variantsByGenericId.set(g.id, variants.map((v) => ({ ...v, colour: v.variantColor })));
        genericSapArticleMap.set(g.id, sapNum);
    }

    if (variantsByGenericId.size > 0) {
        const results = await syncVariantsToSapViaRfc(variantsByGenericId, genericSapArticleMap);

        await Promise.allSettled(results.map((r) => {
            if (r.success) summary.synced++; else summary.failed++;
            return prisma.gmVariantArticleData.update({
                where: { id: r.id },
                data: {
                    sapSyncStatus: r.success ? 'SYNCED' : 'FAILED',
                    sapSyncMessage: r.message ?? null,
                    ...(r.sapArticleNumber ? { variantArticleNumber: r.sapArticleNumber } : {}),
                },
            });
        }));
    }

    await uploadGmVariantImages(generics);

    return summary;
}

/**
 * Like FG: every variant created in SAP gets its colour image in the
 * article-master bucket as <generic no>-<COLOR>.<ext> (no watermark).
 * Also catches variants synced earlier whose image was never copied.
 */
async function uploadGmVariantImages(generics: { id: string; gmArticleNumber: string | null }[]): Promise<void> {
    for (const g of generics) {
        const base = (g.gmArticleNumber ?? '').trim().replace(/^0+/, '');
        if (!base) continue;
        const synced = await prisma.gmVariantArticleData.findMany({
            where: { genericArticleId: g.id, variantArticleNumber: { not: null }, imageUrl: { not: null } },
            select: { id: true, imageUrl: true, variantColor: true },
        });
        const toUpload = synced.filter((v) => v.imageUrl && !storageService.extractApprovedKeyFromUrl(v.imageUrl));
        // One upload per colour; every size of that colour shares the same image.
        const urlByColor = new Map<string, Promise<string>>();
        await Promise.allSettled(toUpload.map(async (v) => {
            const color = (v.variantColor ?? '').trim().toUpperCase();
            try {
                if (!urlByColor.has(color)) {
                    urlByColor.set(color, storageService
                        .uploadApprovedImageFromSourceUrl(String(v.imageUrl), base, undefined, color || undefined)
                        .then((u) => u.url));
                }
                const url = await urlByColor.get(color)!;
                await prisma.gmVariantArticleData.update({ where: { id: v.id }, data: { imageUrl: url } });
            } catch (err: any) {
                console.error(`[GM_VARIANT_IMG] Upload failed for ${v.id}:`, err?.message);
            }
        }));
    }
}
