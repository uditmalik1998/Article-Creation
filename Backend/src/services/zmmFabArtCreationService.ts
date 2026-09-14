/**
 * zmmFabArtCreationService.ts
 * Calls ZMM_FAB_ART_CREATION_RFC via the SAP RFC proxy for FG New Article fabric article creation.
 * mcCode and hsnCode are resolved from major_category_details; artType from fabric_article_master.
 */

import { prismaClient as prisma } from '../utils/prisma';

const SAP_RFC_PROXY_URL = (process.env.SAP_RFC_PROXY_URL || 'https://sap-api.v2retail.net').replace(/\/$/, '');
const SAP_RFC_KEY       = process.env.SAP_RFC_KEY || 'v2-rfc-proxy-2026';
const SAP_RFC_ENV       = process.env.SAP_RFC_PROXY_ENV || 'prod';

function str(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    return /^-+$/.test(s) ? '' : s;
}

function padVendor(v: unknown): string {
    const s = str(v);
    if (!s) return '';
    return s.padStart(10, '0');
}

function buildImData(
    row: any,
    meta: { mcCode: string | null; hsnCode: string | null; artType: string | null },
): Record<string, string> {
    return {
        ARTICLE_NUMBER:      '',
        ARTICLE_TYPE:        str(meta.artType) || '2111',
        ARTICLE_DES:         str(row.fabricArticleDescription),
        ARTICLE_DES1:        '',
        MC_CATE:             str(meta.mcCode),
        HSN_CODE:            str(meta.hsnCode),
        VENDOR:              padVendor(row.vendorCode),
        VENDOR_ARTICLE:      str(row.fabricArticleNumber),
        MRP_CHAR_VAL:        '',
        SEASON:              '',
        YEAR:                '',
        ZUOM:                'KG',
        FASHION_GRADE:       str(row.articleFashionType),
        PRICE_BAND_CATEGORY: '',
        WEIGHT_NET_G:        '0',
        F_MAIN_MVGR:         '',
        F_COMPOSITION:       '',
        F_CONSTRUCTION:      '',
        F_YARN:              '',
        F_WEAVE:             '',
        F_STRETCH:           '',
        F_FINISH:            '',
        F_COUNT:             '',
        F_GSM_GLM:           '',
        F_WIDTH:             '',
        F_WIDTH_UOM:         '',
        F_WEIGHTTYPE:        '',
        M_FAB_DIV:           str(row.mFabDiv),
        M_YARN:              str(row.mYarn),
        M_FAB_MAIN_MVGR_1:   str(row.mFabMainMvgr1),
        M_FAB_MAIN_MVGR_2:   str(row.mFabMainMvgr2),
        M_WEAVE_01:          str(row.mWeave01),
        M_WEAVE_02:          str(row.mWeave02),
        M_COMPOSITION:       str(row.mComposition),
        M_CONSTRUCTION:      str(row.mConstruction),
        M_FINISH:            str(row.mFinish),
        M_COUNT:             str(row.mCount),
        M_GSM:               str(row.mGsm),
        M_OUNZ:              str(row.mOunz),
        M_WIDTH:             str(row.mWidth),
        M_LYCRA:             str(row.mLycra),
        M_UOM:               '',
        M_BASE_FAB_ART:      '',
        M_REF_FAB_ART:       '',
        A_MAIN_MVGR:         '',
        A_MVGR_02:           '',
        A_BASE_MATERIAL:     '',
        A_SHAPE:             '',
        A_BRAND:             '',
        A_SHADE:             '',
        A_FINISH_TYPE:       '',
    };
}

export async function submitFabricArticles(ids: string[]): Promise<{
    results: { id: string; success: boolean; sapArticleNumber?: string; message?: string }[];
}> {
    const rows = await prisma.fabricArticleData.findMany({
        where: { id: { in: ids } },
    });

    const url = `${SAP_RFC_PROXY_URL}/api/rfc/proxy?env=${SAP_RFC_ENV}`;

    const results = await Promise.all(rows.map(async (row) => {
        const majCat = str(row.majorCategory);

        // Resolve mcCode, hsnCode, artType and status from fabric_article_master
        // matched by maj_cat + mc_des (mc_description stored on the fabric_article_data row)
        const mcDes = str(row.mcDescription);
        if (!mcDes) {
            const msg = `MC Description is required to submit to SAP. Please fill the MC Description field.`;
            console.warn(`[ZMM_FAB_RFC] ${msg} id=${row.id}`);
            await prisma.fabricArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }

        const masterRow = majCat
            ? await prisma.fabricArticleMaster.findFirst({
                where: {
                    majCat: { equals: majCat, mode: 'insensitive' },
                    mcDes: { equals: mcDes, mode: 'insensitive' },
                },
                select: { mcCode: true, hsnCd: true, artType: true, status: true },
              })
            : null;

        if (!masterRow) {
            const msg = `No fabric_article_master row found for major category "${majCat}" + MC Description "${mcDes}". Cannot submit to SAP.`;
            console.warn(`[ZMM_FAB_RFC] ${msg} id=${row.id}`);
            await prisma.fabricArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }
        if (masterRow.status !== 'ACT') {
            const msg = `Major category "${majCat}" is inactive (status: ${masterRow.status}). Cannot submit to SAP.`;
            console.warn(`[ZMM_FAB_RFC] ${msg} id=${row.id}`);
            await prisma.fabricArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }

        // Duplicate check: same majorCategory + fabricArticleDescription already has an article number
        const desc = str(row.fabricArticleDescription);
        if (majCat && desc) {
            const duplicate = await prisma.fabricArticleData.findFirst({
                where: {
                    id: { not: row.id },
                    majorCategory: { equals: majCat, mode: 'insensitive' },
                    fabricArticleDescription: { equals: desc, mode: 'insensitive' },
                    fabricArticleNumber: { not: null },
                },
                select: { id: true, fabricArticleNumber: true },
            });
            if (duplicate) {
                const msg = `Fabric Article already created for the given Grid (existing: ${duplicate.fabricArticleNumber}).`;
                console.warn(`[ZMM_FAB_RFC] Duplicate blocked id=${row.id} — ${msg}`);
                await prisma.fabricArticleData.update({
                    where: { id: row.id },
                    data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
                });
                return { id: row.id, success: false, message: msg };
            }
        }

        const imData = buildImData(row, {
            mcCode:  masterRow.mcCode,
            hsnCode: masterRow.hsnCd,
            artType: masterRow.artType,
        });
        const payload = { bapiname: 'ZMM_FAB_ART_CREATION_RFC', IM_DATA: [imData] };

        console.log(`[ZMM_FAB_RFC] Submitting id=${row.id} majCat=${majCat} mcDes=${mcDes} mcCode=${masterRow.mcCode} hsn=${masterRow.hsnCd} artType=${masterRow.artType}`);
        console.log(`[ZMM_FAB_RFC] Payload:`, JSON.stringify(payload));

        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 120_000);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-RFC-Key': SAP_RFC_KEY },
                body: JSON.stringify(payload),
                signal: ctrl.signal,
            });
            clearTimeout(timer);

            const rawText = await res.text().catch(() => '');
            console.log(`[ZMM_FAB_RFC] HTTP ${res.status} id=${row.id} raw:`, rawText);

            let json: any = {};
            try { json = JSON.parse(rawText); } catch { /* non-JSON */ }

            // Unwrap EV_JSON if the proxy wraps the RFC response as a JSON string
            let ev: any = json;
            if (json?.EV_JSON) {
                try { ev = JSON.parse(json.EV_JSON); } catch { ev = json; }
            }

            console.log(`[ZMM_FAB_RFC] Parsed ev id=${row.id}:`, JSON.stringify(ev));

            // ZMM_FAB_ART_CREATION_RFC returns EX_RETURN array
            // Success: EX_RETURN[0].MSG_TYP === 'S', FAB_ART = new fabric article number
            // Error:   EX_RETURN[0].MSG_TYP === 'E', MESSAGE = error text
            const exReturn: any[] = Array.isArray(ev?.EX_RETURN) ? ev.EX_RETURN : [];
            const firstRow = exReturn[0] ?? {};
            const errorRow = exReturn.find((r: any) => r.MSG_TYP === 'E' || r.MSG_TYP === 'A');

            const isSuccess = !errorRow && (firstRow.MSG_TYP === 'S') && !!firstRow.FAB_ART;
            const sapNumber = isSuccess ? String(firstRow.FAB_ART).trim() : null;
            const msg = errorRow?.MESSAGE
                || firstRow?.MESSAGE
                || (isSuccess
                    ? `${sapNumber} Created Successfully`
                    : `SAP HTTP ${res.status} — raw: ${rawText.slice(0, 400)}`);

            await prisma.fabricArticleData.update({
                where: { id: row.id },
                data: {
                    approvalStatus:       isSuccess ? 'APPROVED' : 'PENDING',
                    sapSyncStatus:        isSuccess ? 'SYNCED'   : 'FAILED',
                    sapSyncMessage:       msg,
                    fabricArticleNumber:  isSuccess ? sapNumber  : row.fabricArticleNumber,
                    approvedAt:           isSuccess ? new Date() : undefined,
                },
            });

            return { id: row.id, success: isSuccess, sapArticleNumber: sapNumber ?? undefined, message: msg };
        } catch (err: any) {
            const msg = err?.message ?? 'Network error';
            await prisma.fabricArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }
    }));

    return { results };
}
