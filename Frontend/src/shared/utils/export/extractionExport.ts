// xlsx (~400 KB) and exceljs (~200 KB) are lazy-loaded inside each export
// function. They never enter the initial bundle — only when the user clicks
// "Export" / "Download CSV". Both libs are cached after first call.
import type { ExtractedRowEnhanced, SchemaItem } from '../../types/extraction/ExtractionTypes';

export interface ExportDataItem {
  [key: string]: string | number | undefined;
}

export const ORDERED_EXPORT_HEADERS = [
  'ARTICLE NUMBER',
  'CREATION DATE',
  'VENDOR CODE',
  'VENDOR NAME',
  'CITY',
  'FINISHED GOODS DIVISION',
  'COM',
  'PICTURE NUMBER',
  'SUB CAT',
  'MAJOR CATEGORY CODE',
  'MAJOR CATEGORY',
  'MERCHANDISE CATEGORY CODE',
  'MERCHANDISE CATEGORY',
  'FATHER DESIGN MACRO',
  'VENDOR SIZE',
  'ACTUAL SIZE',
  'NO OF PRINT',
  'NO OF SIZE',
  'NO OF CLR',
  'PK SIZE',
  'GEN PK SIZE',
  'PACK-NO OF SIZE',
  'PACK-NO OF CLR',
  'DD',
  'BGT SIZE RATIO (INI)',
  'BGT SIZE RATIO (F)',
  'SIZE RATIO',
  'ACC DESNITY',
  'PPK SZ',
  'PACK DES',
  'VND-REF PRST STATUS (R/NR)',
  'OPTION NO',
  'PPK ARTICLE',
  'VAR ARTICLE NO.',
  'ART DESC',
  'RNG-SEG',
  'VENDOR DESIGN NUMBER',
  'M_IMP_ATBT',
  'CHILD DESIGN MICRO',
  'FABRIC DIVISION',
  'M_YARN',
  'M_FAB_MAIN_MVGR_1',
  'M_WEAVE_01',
  'M_FAB_MAIN_MVGR_2',
  'M_WEAVE_02',
  'M_COMPOSITION',
  'M_FINISH',
  'M_CONSTRUCTION',
  'M_GSM',
  'M_COUNT',
  'M_OUNZ',
  'SHADE',
  'M_LYCRA',
  'M_WIDTH',
  'M_FAB_DIV',
  'M_FAB_VDR',
  'OB_BODY_DIV',
  'OB_MICR_BODY _NM',
  'M_NECK_TYPE',
  'M_NECK_STYLE',
  'M_PLACKET',
  'M_BLT_TYPE',
  'M_BLT_STYLE',
  'M_SLEEVES_MAIN_STYLE',
  'M_SLEEVE_FOLD',
  'M_BTM_FOLD',
  'FO BTN STYLE',
  'M_COLLAR_TYPE',
  'M_COLLAR_STYLE',
  'M_POCKET',
  'M_NO_OF_POCKET',
  'M_EXTRA_POCKET',
  'M_FIT',
  'M_BODY_STYLE',
  'M_LENGTH',
  'M_DC_STYLE',
  'M_DC_SHAPE',
  'M_BTN_TYPE',
  'M_BTN_CLR',
  'M_ZIP_TYPE',
  'M_ZIP_COL',
  'M_PRINT_TYPE',
  'M_PRINT_PLACEMENT',
  'M_PRINT_STYLE',
  'M_PATCHE_TYPE',
  'M_PATCH_STYLE',
  'M_EMB_TYPE',
  'M_EMBROIDERY_STYLE',
  'M_EMB_PLACEMENT',
  'M_HTRF_TYPE',
  'M_HTRF_STYLE',
  'M_WASH',
  'ARTICLE TYPE',
  'BUYING_TYPE',
  'PD',
  'BRAND',
  'OLD MC AS GRID',
  'PEND FIELD LIST',
  'FIELD CHECK (STATUS)',
  'NOA',
  'VND ALV-QTY',
  'MIN SET QTY',
  'GEN QTY-MNTH1',
  'GEN QTY-MNTH2',
  'GEN QTY-MNTH3',
  'GEN QTY-MNTH4',
  'GEN QTY-MNTH5',
  'GEN QTY-MNTH6',
  'NO. OF COLOR',
  'GEN-CLR QTY-MNTH1',
  'GEN-CLR QTY-MNTH2',
  'GEN-CLR QTY-MNTH3',
  'GEN-CLR QTY-MNTH4',
  'GEN-CLR QTY-MNTH5',
  'GEN-CLR QTY-MNTH6',
  'QTY-MNTH1',
  'QTY-MNTH2',
  'QTY-MNTH3',
  'QTY-MNTH4',
  'QTY-MNTH5',
  'QTY-MNTH6',
  'PPK ALGO-1',
  'PPK ALGO-2',
  'PPK ALGO-3',
  'PPK ALGO-4',
  'PPK ALGO-5',
  'PPK ALGO-6',
  'PPK CNT-MNTH1',
  'PPK CNT-MNTH2',
  'PPK CNT-MNTH3',
  'PPK CNT-MNTH4',
  'PPK CNT-MNTH5',
  'PPK CNT-MNTH6',
  'LOOSE QTY- MNTH1',
  'LOOSE QTY- MNTH2',
  'LOOSE QTY- MNTH3',
  'LOOSE QTY- MNTH4',
  'LOOSE QTY- MNTH5',
  'LOOSE QTY- MNTH6',
  'PPK LOOSE QTY- MNTH1',
  'PPK LOOSE QTY- MNTH2',
  'PPK LOOSE QTY- MNTH3',
  'PPK LOOSE QTY- MNTH4',
  'PPK LOOSE QTY- MNTH5',
  'PPK LOOSE QTY- MNTH6',
  'COST',
  'NET PRICE',
  'MAXIMUM RETAIL PRICE',
  'PO VAL MNTH1',
  'PO VAL MNTH2',
  'PO VAL MNTH3',
  'PO VAL MNTH4',
  'PO VAL MNTH5',
  'PO VAL MNTH6',
  'MD%',
  'MD% AFTER TAX',
  'TAX %',
  'DEL. DT MNTH1',
  'DEL. DT MNTH2',
  'DEL. DT MNTH3',
  'DEL. DT MNTH4',
  'DEL. DT MNTH5',
  'DEL. DT MNTH6',
  'ART STR',
  'TTL QTY',
  'QTY*CST',
  'QTY*MRP',
  'MD',
  'PRODUCT LIFE CYCLE',
  'GLOBAL/LOCAT ARTICLE',
  'NEW SEASON',
  'COLOR-1',
  'COLOR-2',
  'COLOR-3',
  'COLOR-4',
  'COLOR-5',
  'COLOR-6',
  'COLOR-7',
  'COLOR-8',
  'COLOR-9',
  'COLOR-10',
  'SIZE-1',
  'SIZE-2',
  'SIZE-3',
  'SIZE-4',
  'SIZE-5',
  'SIZE-6',
  'SIZE-7',
  'SIZE-8',
  'SIZE-9',
  'SIZE-10',
  'SIZE-QTY-1',
  'SIZE-QTY-2',
  'SIZE-QTY-3',
  'SIZE-QTY-4',
  'SIZE-QTY-5',
  'SIZE-QTY-6',
  'SIZE-QTY-7',
  'SIZE-QTY-8',
  'SIZE-QTY-9',
  'SIZE-QTY-10',
  'MC_SEG OPTION NO',
  'AUTO_REF_ART',
  'FINAL ART.NO.',
  'REF TYPE',
  'REF ART NO.',
  'FINAL ART DES. (CLR GEN)',
  'PIC HL',
  'M_AGE_GROUP',
  'ARTICLE FASHION TYPE',
  'MVGR_BRAND_VENDOR',
  'WEIGHT',
  'GSM/COUNT',
  'FAB_WEIGHT',
  'GARMENT WEIGHT',
  'BODY (MICRO)',
  'PPK RATE',
  'PPK RATIO',
  'PPK QTY',
  'PPK SET',
  'LOOSE QTY'
];

export const HEADER_TO_SCHEMA_KEY: Record<string, string> = {
  // Identity
  'ARTICLE NUMBER':          'article_number',
  'VENDOR NAME':             'vendor_name',
  'PICTURE NUMBER':          'ppt_number',
  'MAJOR CATEGORY':          'major_category',
  'VENDOR SIZE':             'size',
  'ACTUAL SIZE':             'size',
  'VENDOR DESIGN NUMBER':    'design_number',
  'FINISHED GOODS DIVISION': 'division',
  'COST':                    'rate',
  'NET PRICE':               'rate',
  'VAR ARTICLE NO.':         'reference_article_number',
  'ART DESC':                'reference_article_description',
  // Fabric — SAP names (primary)
  'M_IMP_ATBT':              'macro_mvgr',
  'IMP ATBT-1':              'macro_mvgr',    // legacy alias — old Excel files
  'M_YARN':                  'yarn_01',
  'M_FAB_MAIN_MVGR_1':       'main_mvgr',
  'FAB_MAIN_MVGR-1':         'main_mvgr',     // legacy alias — old Excel files
  'M_WEAVE_01':              'weave',
  'WEAVE 01':                'weave',          // legacy alias — old Excel files
  'M_FAB_MAIN_MVGR_2':       'fabric_main_mvgr',
  'FAB-MAIN-MVGR-2':         'fabric_main_mvgr', // legacy alias — old Excel files
  'M_WEAVE_02':              'm_fab2',
  'WEAVE 02':                'm_fab2',         // legacy alias — old Excel files
  'M_COMPOSITION':           'composition',
  'M_FINISH':                'finish',
  'M_CONSTRUCTION':          'f_construction',
  'M_GSM':                   'gsm',
  'M_COUNT':                 'f_count',
  'M_OUNZ':                  'f_ounce',
  'SHADE':                   'shade',
  'M_LYCRA':                 'lycra_non_lycra',
  'M_WIDTH':                 'f_width',
  'M_FAB_DIV':               'fab_div',
  'M_FAB_VDR':               'fab_vdr',
  // Body — SAP names (primary)
  'M_NECK_TYPE':             'neck',
  'M_NECK_STYLE':            'neck_details',
  'M_PLACKET':               'placket',
  'M_BLT_TYPE':              'father_belt',
  'M_BLT_STYLE':             'child_belt',
  'M_SLEEVES_MAIN_STYLE':    'sleeve',
  'M_SLEEVE_FOLD':           'sleeve_fold',
  'M_BTM_FOLD':              'bottom_fold',
  'FO BTN STYLE':            'front_open_style',
  'M_COLLAR_TYPE':           'collar',
  'M_COLLAR_STYLE':          'collar_style',
  'M_POCKET':                'pocket_type',
  'M_NO_OF_POCKET':          'no_of_pocket',
  'M_EXTRA_POCKET':          'extra_pocket',
  'M_FIT':                   'fit',
  'M_BODY_STYLE':            'body_style',
  'BODY STYLE':              'body_style',    // legacy alias — old Excel files
  'M_LENGTH':                'length',
  // VA Accessories — SAP names (primary)
  'M_DC_STYLE':              'drawcord',
  'M_DC_SHAPE':              'dc_shape',
  'M_BTN_TYPE':              'button',
  'M_BTN_CLR':               'btn_colour',
  'M_ZIP_TYPE':              'zipper',
  'M_ZIP_COL':               'zip_colour',
  'M_PATCHE_TYPE':           'patches',
  'M_PATCH_STYLE':           'patches_type',
  // VA Processing — SAP names (primary)
  'M_PRINT_TYPE':            'print_type',
  'M_PRINT_STYLE':           'print_style',
  'M_PRINT_PLACEMENT':       'print_placement',
  'M_EMB_TYPE':              'embroidery',
  'M_EMBROIDERY_STYLE':      'embroidery_type',
  'M_EMB_PLACEMENT':         'emb_placement',
  'M_HTRF_TYPE':             'htrf_type',
  'M_HTRF_STYLE':            'htrf_style',
  'M_WASH':                  'wash',
  // Business
  'M_AGE_GROUP':             'age_group',
  'ARTICLE FASHION TYPE':    'article_fashion_type',
  'MVGR_BRAND_VENDOR':       'mvgr_brand_vendor',
  'WEIGHT':                  'weight',
  'SEGMENT':                 'segment',
  // Legacy aliases (old grid names still resolve correctly)
  'YARN-01':                 'yarn_01',
  'GRAM PER SQUARE METER':   'gsm',
  'GSM/COUNT':               'gsm',
  'LYCRA/ NON LYCRA':        'lycra_non_lycra',
  'NECK':                    'neck',
  'NECK DETAIL':             'neck_details',
  'PLACKET':                 'placket',
  'FATHER BELT':             'father_belt',
  'CHILD BELT DETAIL':       'child_belt',
  'SLEEVE':                  'sleeve',
  'BOTTOM FOLD':             'bottom_fold',
  'FRONT OPEN STYLE':        'front_open_style',
  'POCKET TYPE':             'pocket_type',
  'FIT':                     'fit',
  'PATTERN':                 'body_style',
  'LENGTH':                  'length',
  'DRAWCORD':                'drawcord',
  'BUTTON':                  'button',
  'ZIPPER':                  'zipper',
  'ZIP COLOUR':              'zip_colour',
  'PRINT TYPE':              'print_type',
  'PRINT_PLACEMENT':         'print_placement',
  'PRINT_STYLE':             'print_style',
  'PATCHES':                 'patches',
  'PATCH TYPE':              'patches_type',
  'EMBROIDERY':              'embroidery',
  'EMBROIDERY_TYPE':         'embroidery_type',
  'WASH':                    'wash',
};

export const mapMasterAttributes = (data: any[]): SchemaItem[] => {
  if (!Array.isArray(data)) return [];
  return data.map((attr: any) => ({
    key: attr.key,
    label: attr.label,
    type: (attr.type || 'text').toLowerCase(),
    required: !!attr.required,
    allowedValues: (attr.allowedValues || []).map((v: any) => ({
      shortForm: v.shortForm,
      fullForm: v.fullForm
    }))
  })) as SchemaItem[];
};

export const buildExportSchema = (schema: SchemaItem[], masterAttributes: SchemaItem[]): SchemaItem[] => {
  const base = masterAttributes.length > 0 ? masterAttributes : schema;
  const referenceFields = schema.filter(item =>
    item.key === 'reference_article_number' || item.key === 'reference_article_description'
  );

  let merged = [...base];
  const refsToAdd = referenceFields.filter(ref => !merged.some(item => item.key === ref.key));
  if (refsToAdd.length > 0) {
    const majorIndex = merged.findIndex(item => item.key === 'major_category');
    if (majorIndex >= 0) {
      merged.splice(majorIndex + 1, 0, ...refsToAdd);
    } else {
      merged = [...refsToAdd, ...merged];
    }
  }

  const extras = schema.filter(item => !merged.some(m => m.key === item.key));
  if (extras.length > 0) {
    merged = [...merged, ...extras];
  }

  return merged;
};

export const resolveFullForm = (schemaItem: SchemaItem | undefined, value: unknown) => {
  if (value === null || value === undefined) return '';
  if (!schemaItem?.allowedValues || schemaItem.allowedValues.length === 0) {
    return typeof value === 'string' || typeof value === 'number' ? value : String(value);
  }

  const valueStr = String(value);
  const match = schemaItem.allowedValues.find(v =>
    v.shortForm?.toLowerCase?.() === valueStr.toLowerCase() ||
    v.fullForm?.toLowerCase?.() === valueStr.toLowerCase()
  );

  if (match?.fullForm) return match.fullForm;
  if (match?.shortForm) return match.shortForm;
  return valueStr;
};

export const prepareExportData = (
  extractedRows: ExtractedRowEnhanced[],
  exportSchema: SchemaItem[],
  orderedHeaders: string[],
  includeMetadata: boolean,
  includeDiscoveries: boolean
): ExportDataItem[] => {
  const schemaByKey = new Map(exportSchema.map(item => [item.key, item]));
  const schemaByLabel = new Map(
    exportSchema.map(item => [String(item.label || item.key).toLowerCase(), item])
  );

  return extractedRows.map((row) => {
    const baseData: ExportDataItem = {};

    orderedHeaders.forEach((header) => {
      const mappedKey = HEADER_TO_SCHEMA_KEY[header];
      const schemaItem = mappedKey
        ? schemaByKey.get(mappedKey)
        : schemaByLabel.get(header.toLowerCase());

      if (schemaItem) {
        const key = schemaItem.key;
        const attribute = row.attributes[key];
        const value = attribute?.schemaValue ?? attribute?.rawValue ?? '';
        // Use string comparison for type check to avoid enum type mismatch
        if ((schemaItem.type as string) === 'date' && value) {
          const date = new Date(String(value));
          if (!isNaN(date.getTime())) {
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            baseData[header] = `${day}/${month}/${year}`;
          } else {
            baseData[header] = String(value);
          }
        }
        // Check for numeric fields (either by type 'number' or specific headers)
        else if (
          (schemaItem.type as string) === 'number' ||
          header.includes('COST') ||
          header.includes('PRICE') ||
          header.includes('RATE') ||
          header.includes('QTY') ||
          header.includes('VAL') ||
          header.includes('%') ||
          header.includes('RATIO')
        ) {
          if (value === null || value === undefined || value === '') {
            baseData[header] = '';
          } else {
            // Remove currency symbols or commas if present before parsing
            const cleanValue = String(value).replace(/[^0-9.-]/g, '');
            const numVal = parseFloat(cleanValue);
            baseData[header] = isNaN(numVal) ? String(value) : numVal;
          }
        }
        else {
          baseData[header] = resolveFullForm(schemaItem, value);
        }

        if (includeMetadata && attribute) {
          baseData[`${header} (Confidence)`] = `${attribute.visualConfidence || 0}%`;
        }
      } else if (header === 'ARTICLE NUMBER') {
        // Extract image name without .jpg extension
        const fileName = (row as any).originalFileName || '';
        baseData[header] = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, '');
      } else if (header === 'CREATION DATE') {
        const createdAt = (row as any).createdAt;
        if (createdAt) {
          const date = new Date(createdAt);
          // Format as DD/MM/YYYY
          const day = date.getDate().toString().padStart(2, '0');
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const year = date.getFullYear();
          baseData[header] = `${day}/${month}/${year}`;
        } else {
          baseData[header] = '';
        }
      } else {
        baseData[header] = '';
      }
    });

    if (includeMetadata) {
      baseData['Processing Time (ms)'] = row.extractionTime || 0;
      baseData['AI Model'] = row.modelUsed || 'N/A';
      baseData['Tokens Used'] = row.apiTokensUsed || 0;
    }

    if (includeDiscoveries && row.discoveries) {
      row.discoveries.forEach(discovery => {
        baseData[`Discovery: ${discovery.label}`] = discovery.normalizedValue;
      });
    }

    return baseData;
  });
};

export const exportToExcel = async (
  data: ExportDataItem[],
  orderedHeaders: string[],
  exportSchema: SchemaItem[],
  categoryName?: string,
  options?: {
    /** Exact file name before "-<date>.xlsx" (no "fashion-extraction-" prefix). */
    fileBaseName?: string;
  }
) => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Fashion Extractor';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Extraction Results');
  const listSheet = workbook.addWorksheet('Lists');
  listSheet.state = 'hidden';

  const headers = orderedHeaders.length > 0 ? orderedHeaders : (data.length > 0 ? Object.keys(data[0]) : []);
  worksheet.columns = headers.map((key) => ({
    header: key,
    key,
    width: key === 'Image Name' ? 30 : 18
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: false, size: 12 };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  data.forEach((row) => {
    const rowValues = headers.map(h => row[h]);
    const excelRow = worksheet.addRow(rowValues);
    excelRow.font = { size: 10 };
  });

  if (data.length > 0) {
    const headerIndex = new Map<string, number>();
    headers.forEach((h, idx) => headerIndex.set(h, idx + 1));

    let listColumn = 1;
    const selectedSchema = exportSchema;

    for (const schemaItem of selectedSchema) {
      if (schemaItem.type !== 'select' || !schemaItem.allowedValues || schemaItem.allowedValues.length === 0) {
        continue;
      }

      const headerKey = schemaItem.label || schemaItem.key;
      const targetCol = headerIndex.get(headerKey);
      const mappedHeader = Object.keys(HEADER_TO_SCHEMA_KEY).find(h => HEADER_TO_SCHEMA_KEY[h] === schemaItem.key);
      const resolvedCol = targetCol || (mappedHeader ? headerIndex.get(mappedHeader) : undefined);
      if (!resolvedCol) continue;

      const values = schemaItem.allowedValues
        .map(v => typeof v === 'string' ? v : (v.fullForm || v.shortForm))
        .filter(Boolean) as string[];

      if (values.length === 0) continue;

      listSheet.getColumn(listColumn).values = [undefined, ...values];
      const listColLetter = listSheet.getColumn(listColumn).letter;
      const listRange = `Lists!$${listColLetter}$1:$${listColLetter}$${values.length}`;

      for (let r = 2; r <= data.length + 1; r += 1) {
        worksheet.getCell(r, resolvedCol).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [listRange],
          showErrorMessage: false,
          errorStyle: 'warning'
        };
      }

      listColumn += 1;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const link = document.createElement('a');
  const baseName = options?.fileBaseName
    ? options.fileBaseName
    : categoryName === 'Article Creation'
    ? 'Article Creation'
    : `fashion-extraction-${categoryName?.replace(/\s+/g, '-') || 'results'}`;
  const fileName = `${baseName}-${new Date().toISOString().split('T')[0]}.xlsx`;
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToCSV = async (data: ExportDataItem[], categoryName?: string) => {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const fileName = `fashion-extraction-${categoryName?.replace(/\s+/g, '-') || 'results'}-${new Date().toISOString().split('T')[0]}.csv`;

  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportToJSON = async (
  data: ExportDataItem[],
  schema: SchemaItem[],
  categoryName?: string
) => {
  const exportObject = {
    metadata: {
      exportDate: new Date().toISOString(),
      category: categoryName,
      totalRecords: data.length,
      schema: schema.map(item => ({
        key: item.key,
        label: item.label,
        type: item.type,
        required: item.required
      }))
    },
    data
  };

  const json = JSON.stringify(exportObject, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  const fileName = `fashion-extraction-${categoryName?.replace(/\s+/g, '-') || 'results'}-${new Date().toISOString().split('T')[0]}.json`;

  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};




















































































































































































































































































































































































































































































