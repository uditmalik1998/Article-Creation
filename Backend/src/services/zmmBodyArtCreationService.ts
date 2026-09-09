/**
 * zmmBodyArtCreationService.ts
 * Calls ZMM_BODY_ART_CRT_V3 via the SAP RFC proxy for body article creation.
 * HSN_CODE and MC_CD are resolved from major_category_details by majorCategory.
 */

import { prismaClient as prisma } from '../utils/prisma';

const SAP_RFC_PROXY_URL = (process.env.SAP_RFC_PROXY_URL || 'https://sap-api.v2retail.net').replace(/\/$/, '');
const SAP_RFC_KEY       = process.env.SAP_RFC_KEY || 'v2-rfc-proxy-2026';
const SAP_RFC_ENV       = process.env.SAP_RFC_PROXY_ENV || 'prod';

function str(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    // Treat placeholder dashes (e.g. "-", "--") as empty — not valid SAP MVGR codes
    return /^-+$/.test(s) ? '' : s;
}

/** SAP vendor codes must be 10 digits, left-padded with zeros. */
function padVendor(v: unknown): string {
    const s = str(v);
    if (!s) return '';
    return s.padStart(10, '0');
}

function buildImData(row: any, mcDetails: { mcCode: string | null; hsnCode: string | null }): Record<string, string> {
    return {
        HSN_CODE:             str(mcDetails.hsnCode),
        SUB_DIV:              str(row.subDivision),
        MC_CD:                str(mcDetails.mcCode),
        VENDOR:               padVendor(row.vendorCode),
        DSG_NO:               str(row.designNumber),
        MRP:                  '',
        SEASON:               str(row.season),
        ARTICLE_DES1:         str(row.bodyArticleDescription),
        PRICE_BAND_CATEGORY:  '',
        M_MAIN_MVGR:          '',
        M_MACRO_MVGR:         '',
        M_FAB_DIV:            '',
        M_FAB:                '',
        M_FAB2:               '',
        M_YARN:               '',
        M_YARN02:             '',
        M_WEAVE_2:            '',
        M_COMPOSITION:        '',
        M_FINISH:             '',
        M_CONSTRUCTION:       '',
        M_SHADE:              '',
        M_LYCRA:              '',
        M_GSM:                '',
        M_COUNT:              '',
        M_OUNZ:               '',
        M_COLLAR:             '',
        M_NECK_BAND_STYLE:    '',
        M_PLACKET:            str(row.mPlacket),
        M_BLT_MAIN_STYLE:     str(row.mBltType),
        M_SUB_STYLE_BLT:      str(row.mBltStyle),
        M_SLEEVES_MAIN_STYLE: str(row.mSleevesMainStyle),
        M_BTM_FOLD:           str(row.mBtmFold),
        M_NECK_BAND:          str(row.mNeckType),
        M_FO_BTN_STYLE:       '',
        NO_OF_POCKET:         str(row.mNoOfPocket),
        M_POCKET:             str(row.mPocket),
        POCKET_PLACEMENT:     '',
        M_FIT:                str(row.mFit),
        M_PATTERN:            '',
        M_LENGTH:             str(row.mLength),
        M_DC_SUB_STYLE:       '',
        M_BTN_MAIN_MVGR:      '',
        M_ZIP:                '',
        M_ZIP_COL:            '',
        M_PRINT_TYPE:         '',
        M_PRINT_PLACEMENT:    '',
        M_PRINT_STYLE:        '',
        M_PATCHES:            '',
        M_PATCH_TYPE:         '',
        M_EMBROIDERY:         '',
        M_EMB_TYPE:           '',
        M_WASH:               '',
        M_PD:                 '',
        M_WIDTH:              '',
        M_COLLAR_STYLE:       str(row.mCollarStyle),
        M_NO_OF_POCKET:       str(row.mNoOfPocket),
        M_SLEEVE_FOLD:        str(row.mSleeveFold),
        M_HTRF_STYLE:         '',
        M_BTN_CLR:            '',
        M_DC_SHAPE:           '',
        M_HTRF_TYPE:          '',
        M_EMB_PLACEMENT:      '',
        M_AGE_GROUP:          '',
        M_EXTRA_POCKET:       str(row.mExtraPocket),
        MVGR_BRAND_VENDOR:    '',
        NET_WEIGHT:           '0',
        M_FAB_MAIN_MVGR_1:    '',
        M_FAB_MAIN_MVGR_2:    '',
        M_WEAVE_01:           '',
        M_WEAVE_02:           '',
        M_NECK_TYPE:          str(row.mNeckType),
        M_NECK_STYLE:         str(row.mNeckStyle),
        M_COLLAR_TYPE:        str(row.mCollarType),
        M_BLT_TYPE:           str(row.mBltType),
        M_BLT_STYLE:          str(row.mBltStyle),
        M_BODY_STYLE:         str(row.mBodyStyle),
        M_DC_STYLE:           '',
        M_ZIP_TYPE:           '',
        M_BTN_TYPE:           '',
        M_PATCH_STYLE:        '',
        M_PATCHE_TYPE:        '',
        M_EMBROIDERY_STYLE:   '',
        M_FAB_VDR:            '',
        M_IMP_ATBT:           '',
        M_SET:                str(row.mSet),
    };
}

export async function submitBodyArticles(ids: string[]): Promise<{
    results: { id: string; success: boolean; sapArticleNumber?: string; message?: string }[];
}> {
    const rows = await prisma.bodyArticleData.findMany({
        where: { id: { in: ids } },
    });

    const url = `${SAP_RFC_PROXY_URL}/api/rfc/proxy?env=${SAP_RFC_ENV}`;

    const results = await Promise.all(rows.map(async (row) => {
        // Resolve HSN_CODE and MC_CD from major_category_details by majorCategory
        const majCat = str(row.majorCategory);
        const mcDetails = majCat
            ? await prisma.majorCategoryDetails.findFirst({
                where: { majCat: { equals: majCat, mode: 'insensitive' } },
                select: { mcCode: true, hsnCode: true, mcStatus: true },
              })
            : null;

        // Block submission if major category is not found or is inactive
        if (!mcDetails) {
            const msg = `Major category "${majCat}" not found in major_category_details. Cannot submit to SAP.`;
            console.warn(`[ZMM_BODY_RFC] ${msg} id=${row.id}`);
            return { id: row.id, success: false, message: msg };
        }
        if (mcDetails.mcStatus !== 'ACT') {
            const msg = `Major category "${majCat}" is inactive (status: ${mcDetails.mcStatus}). Cannot submit to SAP.`;
            console.warn(`[ZMM_BODY_RFC] ${msg} id=${row.id}`);
            return { id: row.id, success: false, message: msg };
        }

        const imData = buildImData(row, { mcCode: mcDetails.mcCode, hsnCode: mcDetails.hsnCode });
        const payload = { bapiname: 'ZMM_BODY_ART_CRT_V3', IM_DATA: [imData] };

        console.log(`[ZMM_BODY_RFC] Submitting id=${row.id} majCat=${majCat} mcCode=${mcDetails.mcCode} hsn=${mcDetails.hsnCode}`);

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
            console.log(`[ZMM_BODY_RFC] HTTP ${res.status} id=${row.id} raw:`, rawText);

            let json: any = {};
            try { json = JSON.parse(rawText); } catch { /* non-JSON response */ }

            let ev: any = json;
            if (json?.EV_JSON) {
                try { ev = JSON.parse(json.EV_JSON); } catch { ev = json; }
            }

            console.log(`[ZMM_BODY_RFC] Parsed ev id=${row.id}:`, JSON.stringify(ev));

            // ZMM_BODY_ART_CRT_V3 returns EX_DATA array — article number in SAP_ART, errors in MSG_TYP=E rows
            const exDataArray: any[] = Array.isArray(ev?.EX_DATA) ? ev.EX_DATA : [];
            const exDataRow = exDataArray[0] ?? {};

            // Only treat SAP_ART as the article number if the row is NOT an error.
            // When SAP fails, it echoes the failing characteristic name into SAP_ART (e.g. "M_SLEEVE_FOLD").
            const exDataError = exDataArray.find((r: any) => r.MSG_TYP === 'E' || r.MSG_TYP === 'A');
            const exDataRowIsError = exDataRow.MSG_TYP === 'E' || exDataRow.MSG_TYP === 'A';
            const sapNumber = (!exDataRowIsError && exDataRow?.SAP_ART)
                ? exDataRow.SAP_ART
                : (ev?.ARTICLE_NUMBER || ev?.article_number || ev?.MATNR || null);

            const success = res.ok && !!sapNumber && !exDataError;

            // Error priority: EX_DATA error row → RETURN table → top-level fields → raw HTTP
            const returnEntry = Array.isArray(ev?.RETURN) ? ev.RETURN.find((r: any) => r.TYPE === 'E' || r.TYPE === 'A') : null;
            const msg = exDataError?.MESSAGE
                || returnEntry?.MESSAGE
                || ev?.MESSAGE || ev?.message
                || ev?.ERROR || ev?.error
                || (success ? 'Created' : `SAP returned HTTP ${res.status}: ${rawText.slice(0, 200)}`);

            await prisma.bodyArticleData.update({
                where: { id: row.id },
                data: {
                    approvalStatus:    success ? 'APPROVED' : 'PENDING',
                    sapSyncStatus:     success ? 'SYNCED' : 'FAILED',
                    sapSyncMessage:    msg,
                    bodyArticleNumber: success ? sapNumber : row.bodyArticleNumber,
                    approvedAt:        success ? new Date() : undefined,
                },
            });

            return { id: row.id, success, sapArticleNumber: sapNumber ?? undefined, message: msg };
        } catch (err: any) {
            const msg = err?.message ?? 'Network error';
            await prisma.bodyArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }
    }));

    return { results };
}
