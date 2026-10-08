/**
 * zmmGMArtCreationService.ts
 * Calls ZMM_ART_CRT_V3 via the SAP RFC proxy for GM article creation.
 * MC_CD is resolved from gm_major_category_details by maj_cat_nm.
 * HSN_CODE is resolved from major_category_details by majCat.
 */

import { prismaClient as prisma } from '../utils/prisma';

const SAP_RFC_PROXY_URL = (process.env.SAP_RFC_PROXY_URL || 'https://sap-api.v2retail.net').replace(/\/$/, '');
const SAP_RFC_KEY       = process.env.SAP_RFC_KEY       || 'v2-rfc-proxy-2026';
const SAP_RFC_ENV       = process.env.SAP_RFC_PROXY_ENV || 'prod';

function str(v: unknown): string {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

/** SAP vendor codes must be 10 digits, left-padded with zeros. */
function padVendor(v: unknown): string {
    const s = str(v);
    if (!s) return '';
    return s.padStart(10, '0');
}

/** All GM_ attribute family codes that map 1:1 to gmArticleData fields. */
const ALL_GM_FAMILY_CODES = [
    'GM_BRAND', 'GM_CLOSURE_TYPE', 'GM_COLOUR_FAMILY', 'GM_COLOUR_SHADE',
    'GM_FW_SIZE', 'GM_FW_SOLE', 'GM_FW_TOE', 'GM_FW_UPPER',
    'GM_MATERIAL', 'GM_MATERIAL_GROUP', 'GM_PRICE_TIER', 'GM_SEASON',
    'GM_SELL_UOM', 'GM_FW_HEEL_HT_CM', 'GM_FW_HEEL_TYPE', 'GM_LIFESTAGE',
    'GM_LINING_MATERIAL', 'GM_MANUFACTURER', 'GM_NET_WEIGHT_G', 'GM_PATTERN',
    'GM_USAGE_OCCASION', 'GM_APPLICATOR', 'GM_COSMETIC_FINISH', 'GM_NET_CONTENT',
    'GM_SHELF_LIFE_MONTHS', 'GM_CERTIFICATION', 'GM_KEY_INGREDIENT', 'GM_SKIN_TYPE',
    'GM_LENGTH_CM', 'GM_PRINT_THEME', 'GM_SURFACE_FINISH', 'GM_TEXTILE_FABRIC',
    'GM_WEAVE', 'GM_YARN', 'GM_CAPACITY_ML', 'GM_HEIGHT_CM', 'GM_INSULATION_TYPE',
    'GM_LEAK_PROOF', 'GM_LID_TYPE', 'GM_BPA_FREE', 'GM_HEAT_RETENTION_HR',
    'GM_DIAMETER_CM', 'GM_DISHWASHER_SAFE', 'GM_MICROWAVE_SAFE', 'GM_COMPARTMENT_COUNT',
    'GM_WIDTH_CM', 'GM_FRAGRANCE_CONC', 'GM_FRAGRANCE_FAMILY', 'GM_SET_CONTENTS',
    'GM_BRAND_TYPE', 'GM_MATERIAL_SECONDARY', 'GM_WHEEL_COUNT', 'GM_CARE_INSTRUCTION',
    'GM_STRAP_TYPE', 'GM_DIM_STANDARD', 'GM_GSM', 'GM_THREAD_COUNT',
    'GM_COMPOSITION', 'GM_WARRANTY_MONTHS', 'GM_SPORT', 'GM_PLAYER_COUNT',
    'GM_BPC_FORM', 'GM_NET_CONTENT_UOM', 'GM_SPF', 'GM_FREE_FROM',
    'GM_PACK_QTY', 'GM_AGE_GRADE', 'GM_FOLDABLE', 'GM_PLAY_PATTERN',
    'GM_POWER_SOURCE', 'GM_BATTERY_TYPE', 'GM_LICENCE', 'GM_FOOD_CONTACT_SAFE',
    'GM_MOUNT_TYPE', 'GM_BASE_TYPE', 'GM_COATING', 'GM_VOLTAGE_V', 'GM_WATTAGE_W',
] as const;

/**
 * Converts a GM_ family code to its camelCase Prisma field name.
 * e.g. GM_CAPACITY_ML → gmCapacityMl
 */
function familyCodeToPrismaField(familyCode: string): string {
    const withoutPrefix = familyCode.slice(3); // remove "GM_"
    const parts = withoutPrefix.toLowerCase().split('_');
    const camel = parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    return 'gm' + camel.charAt(0).toUpperCase() + camel.slice(1);
}

function buildImData(
    row: any,
    mc: { mcCd: string | null; hsnCode: string | null },
): Record<string, string> {
    return {
        HSN_CODE:                str(mc.hsnCode),
        SUB_DIV:                 str(row.subDivision),
        MC_CD:                   str(mc.mcCd),
        VENDOR:                  padVendor(row.vendorCode),
        DSG_NO:                  str(row.designNumber),
        MRP:                     str(row.mrp),
        SEASON:                  '',
        ARTICLE_DES1:            str(row.gmArticleDescription),
        PRICE_BAND_CATEGORY:     '',
        GM_BRAND:                str(row.gmBrand),
        GM_CLOSURE_TYPE:         str(row.gmClosureType),
        GM_COLOUR_FAMILY:        str(row.gmColourFamily),
        GM_COLOUR_SHADE:         str(row.gmColourShade),
        GM_FW_SIZE:              str(row.gmFwSize),
        GM_FW_SOLE:              str(row.gmFwSole),
        GM_FW_TOE:               str(row.gmFwToe),
        GM_FW_UPPER:             str(row.gmFwUpper),
        GM_MATERIAL:             str(row.gmMaterial),
        GM_MATERIAL_GROUP:       str(row.gmMaterialGroup),
        GM_PRICE_TIER:           str(row.gmPriceTier),
        GM_SEASON:               str(row.gmSeason),
        GM_SELL_UOM:             str(row.gmSellUom),
        GM_FW_HEEL_HT_CM:        str(row.gmFwHeelHtCm),
        GM_FW_HEEL_TYPE:         str(row.gmFwHeelType),
        GM_LIFESTAGE:            str(row.gmLifestage),
        GM_LINING_MATERIAL:      str(row.gmLiningMaterial),
        GM_MANUFACTURER:         str(row.gmManufacturer),
        GM_NET_WEIGHT_G:         str(row.gmNetWeightG),
        GM_PATTERN:              str(row.gmPattern),
        GM_USAGE_OCCASION:       str(row.gmUsageOccasion),
        GM_APPLICATOR:           str(row.gmApplicator),
        GM_COSMETIC_FINISH:      str(row.gmCosmeticFinish),
        GM_NET_CONTENT:          str(row.gmNetContent),
        GM_SHELF_LIFE_MONTHS:    str(row.gmShelfLifeMonths),
        GM_CERTIFICATION:        str(row.gmCertification),
        GM_KEY_INGREDIENT:       str(row.gmKeyIngredient),
        GM_SKIN_TYPE:            str(row.gmSkinType),
        GM_LENGTH_CM:            str(row.gmLengthCm),
        GM_PRINT_THEME:          str(row.gmPrintTheme),
        GM_SURFACE_FINISH:       str(row.gmSurfaceFinish),
        GM_TEXTILE_FABRIC:       str(row.gmTextileFabric),
        GM_WEAVE:                str(row.gmWeave),
        GM_YARN:                 str(row.gmYarn),
        GM_CAPACITY_ML:          str(row.gmCapacityMl),
        GM_HEIGHT_CM:            str(row.gmHeightCm),
        GM_INSULATION_TYPE:      str(row.gmInsulationType),
        GM_LEAK_PROOF:           str(row.gmLeakProof),
        GM_LID_TYPE:             str(row.gmLidType),
        GM_BPA_FREE:             str(row.gmBpaFree),
        GM_HEAT_RETENTION_HR:    str(row.gmHeatRetentionHr),
        GM_DIAMETER_CM:          str(row.gmDiameterCm),
        GM_DISHWASHER_SAFE:      str(row.gmDishwasherSafe),
        GM_MICROWAVE_SAFE:       str(row.gmMicrowaveSafe),
        GM_COMPARTMENT_COUNT:    str(row.gmCompartmentCount),
        GM_WIDTH_CM:             str(row.gmWidthCm),
        GM_FRAGRANCE_CONC:       str(row.gmFragranceConc),
        GM_FRAGRANCE_FAMILY:     str(row.gmFragranceFamily),
        GM_SET_CONTENTS:         str(row.gmSetContents),
        GM_BRAND_TYPE:           str(row.gmBrandType),
        GM_MATERIAL_SECONDARY:   str(row.gmMaterialSecondary),
        GM_WHEEL_COUNT:          str(row.gmWheelCount),
        GM_CARE_INSTRUCTION:     str(row.gmCareInstruction),
        GM_STRAP_TYPE:           str(row.gmStrapType),
        GM_DIM_STANDARD:         str(row.gmDimStandard),
        GM_GSM:                  str(row.gmGsm),
        GM_THREAD_COUNT:         str(row.gmThreadCount),
        GM_COMPOSITION:          str(row.gmComposition),
        GM_WARRANTY_MONTHS:      str(row.gmWarrantyMonths),
        GM_SPORT:                str(row.gmSport),
        GM_PLAYER_COUNT:         str(row.gmPlayerCount),
        GM_BPC_FORM:             str(row.gmBpcForm),
        GM_NET_CONTENT_UOM:      str(row.gmNetContentUom),
        GM_SPF:                  str(row.gmSpf),
        GM_FREE_FROM:            str(row.gmFreeFrom),
        GM_PACK_QTY:             str(row.gmPackQty),
        GM_AGE_GRADE:            str(row.gmAgeGrade),
        GM_FOLDABLE:             str(row.gmFoldable),
        GM_PLAY_PATTERN:         str(row.gmPlayPattern),
        GM_POWER_SOURCE:         str(row.gmPowerSource),
        GM_BATTERY_TYPE:         str(row.gmBatteryType),
        GM_LICENCE:              str(row.gmLicence),
        GM_FOOD_CONTACT_SAFE:    str(row.gmFoodContactSafe),
        GM_MOUNT_TYPE:           str(row.gmMountType),
        GM_BASE_TYPE:            str(row.gmBaseType),
        GM_COATING:              str(row.gmCoating),
        GM_VOLTAGE_V:            str(row.gmVoltageV),
        GM_WATTAGE_W:            str(row.gmWattageW),
        GM_GENDER:               '',
    };
}

export async function submitGmArticles(ids: string[]): Promise<{
    results: { id: string; success: boolean; sapArticleNumber?: string; message?: string }[];
}> {
    const rows = await prisma.gmArticleData.findMany({
        where: { id: { in: ids } },
    });

    const url = `${SAP_RFC_PROXY_URL}/api/rfc/proxy?env=${SAP_RFC_ENV}`;

    const results = await Promise.all(rows.map(async (row) => {
        const majCat = str(row.majorCategory);

        // Resolve MC_CD and HSN_CODE from gm_major_category_details in a single query
        const gmMcRows = majCat
            ? await prisma.$queryRaw<{ mc_cd: string | null; hsn_cd: string | null }[]>`
                SELECT DISTINCT mc_cd, hsn_cd FROM gm_major_category_details
                WHERE maj_cat_nm = ${majCat} AND mj_status = 'ACT'
                LIMIT 1
              `
            : [];
        const mcCd    = gmMcRows[0]?.mc_cd  ?? null;
        const hsnCode = gmMcRows[0]?.hsn_cd ?? null;

        if (!mcCd) {
            const msg = `Major category "${majCat}" not found in gm_major_category_details. Cannot submit to SAP.`;
            console.warn(`[ZMM_ART_CRT_V3] ${msg} id=${row.id}`);
            await prisma.gmArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }

        // Fetch valid family codes for this major category and null out any stale attributes
        const validFcRows = await prisma.$queryRaw<{ family_code: string }[]>`
            SELECT DISTINCT family_code FROM gm_major_category_details
            WHERE maj_cat_nm = ${majCat} AND mj_status = 'ACT'
              AND family_code IS NOT NULL AND family_code <> ''
        `;
        const validFamilyCodes = new Set(validFcRows.map(r => r.family_code));

        const nullUpdates: Record<string, null> = {};
        for (const fc of ALL_GM_FAMILY_CODES) {
            if (!validFamilyCodes.has(fc)) {
                const prismaField = familyCodeToPrismaField(fc);
                if ((row as any)[prismaField] != null) {
                    nullUpdates[prismaField] = null;
                }
            }
        }

        let currentRow: typeof row = row;
        if (Object.keys(nullUpdates).length > 0) {
            currentRow = await prisma.gmArticleData.update({
                where: { id: row.id },
                data: nullUpdates,
            }) as typeof row;
            console.log(`[ZMM_ART_CRT_V3] Nulled ${Object.keys(nullUpdates).length} stale attrs for id=${row.id}: ${Object.keys(nullUpdates).join(', ')}`);
        }

        const imData = buildImData(currentRow, { mcCd, hsnCode });
        const payload = { bapiname: 'ZMM_ART_CRT_V3', IM_DATA: [imData] };

        console.log(`[ZMM_ART_CRT_V3] Submitting id=${row.id} majCat=${majCat} mc_cd=${mcCd}`);

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

            let json: any = {};
            try { json = JSON.parse(rawText); } catch { /* non-JSON */ }

            let ev: any = json;
            if (json?.EV_JSON) {
                try { ev = JSON.parse(json.EV_JSON); } catch { ev = json; }
            }

            // ZMM_ART_CRT_V3 returns EX_DATA array — SAP_ART is the new article number
            const exData: any[] = Array.isArray(ev?.EX_DATA) ? ev.EX_DATA : [];
            const exDataRow = exData[0] ?? {};
            const exDataError = exData.find((r: any) => r.MSG_TYP === 'E' || r.MSG_TYP === 'A');
            const exDataRowIsError = exDataRow.MSG_TYP === 'E' || exDataRow.MSG_TYP === 'A';

            const sapNumber = (!exDataRowIsError && exDataRow?.SAP_ART)
                ? String(exDataRow.SAP_ART).trim()
                : null;

            const success = res.ok && !!sapNumber && !exDataError;

            const returnEntry = Array.isArray(ev?.RETURN) ? ev.RETURN.find((r: any) => r.TYPE === 'E' || r.TYPE === 'A') : null;
            const msg = exDataError?.MESSAGE
                || returnEntry?.MESSAGE
                || ev?.MESSAGE || ev?.message
                || ev?.ERROR || ev?.error
                || (success ? `Created: ${sapNumber}` : `SAP returned HTTP ${res.status}: ${rawText.slice(0, 200)}`);

            console.log(`[ZMM_ART_CRT_V3] id=${row.id} success=${success} sapNumber=${sapNumber} msg=${msg}`);

            await prisma.gmArticleData.update({
                where: { id: row.id },
                data: {
                    approvalStatus:   success ? 'APPROVED' : 'PENDING',
                    sapSyncStatus:    success ? 'SYNCED'   : 'FAILED',
                    sapSyncMessage:   msg,
                    gmArticleNumber:  success ? sapNumber! : row.gmArticleNumber,
                    approvedAt:       success ? new Date() : undefined,
                },
            });

            return {
                id: row.id,
                success,
                sapArticleNumber: sapNumber ?? undefined,
                message: msg,
            };
        } catch (err: any) {
            const msg = err?.name === 'AbortError'
                ? 'SAP RFC call timed out (120s)'
                : (err?.message || 'Unknown error calling SAP RFC proxy');
            console.error(`[ZMM_ART_CRT_V3] id=${row.id} error: ${msg}`);
            await prisma.gmArticleData.update({
                where: { id: row.id },
                data: { sapSyncStatus: 'FAILED', sapSyncMessage: msg },
            });
            return { id: row.id, success: false, message: msg };
        }
    }));

    return { results };
}
