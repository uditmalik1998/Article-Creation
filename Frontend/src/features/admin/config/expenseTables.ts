/**
 * Mirrors EXPENSE_TABLE_REGISTRY in Backend/src/controllers/adminController.ts.
 * Column `dataIndex`s must match exactly what GET /admin/expense-table/:tableKey
 * returns for that table (snake_case for raw tables, camelCase for Prisma
 * tables, fixed aliases for `hierarchy`). Keep the two in sync by hand.
 */

export interface ExpenseTableColumnConfig {
  dataIndex: string;
  title: string;
  width?: number;
  type?: 'date' | 'boolean';
  /** Defaults to true. Set false for ids/timestamps and fields owned by another
   * workflow (e.g. fabric/body article data's own approval/SAP-sync fields). */
  editable?: boolean;
}

export interface ExpenseTableConfig {
  title: string;
  description: string;
  rowKey: string;
  defaultSortBy: string;
  defaultSortDir: 'asc' | 'desc';
  columns: ExpenseTableColumnConfig[];
}

export const EXPENSE_TABLE_CONFIGS: Record<string, ExpenseTableConfig> = {
  'major-category-grid': {
    title: 'Major Category Grid (Dropdown Values)',
    description: 'All rows currently stored in maj_cat_grid_values.',
    rowKey: 'id',
    defaultSortBy: 'id',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'major_category', title: 'Major Category' },
      { dataIndex: 'attribute_name', title: 'Attribute Name' },
      { dataIndex: 'value', title: 'Value' },
      { dataIndex: 'uploaded_at', title: 'Uploaded At', type: 'date', editable: false },
    ],
  },
  'size-master': {
    title: 'Size Master (Sizes per Major Category)',
    description: 'All rows currently stored in maj_cat_sizes.',
    rowKey: 'id',
    defaultSortBy: 'id',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'division', title: 'Division' },
      { dataIndex: 'sub_division', title: 'Sub Division' },
      { dataIndex: 'mc_code', title: 'MC Code' },
      { dataIndex: 'major_category', title: 'Major Category' },
      { dataIndex: 'size', title: 'Size' },
      { dataIndex: 'status', title: 'Status' },
      { dataIndex: 'created_at', title: 'Created At', type: 'date', editable: false },
    ],
  },
  'color-master': {
    title: 'Color Master (Father / Child Colours)',
    description: 'All rows currently stored in color_master.',
    rowKey: 'id',
    defaultSortBy: 'id',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'father_color', title: 'Father Color' },
      { dataIndex: 'child_color', title: 'Child Color' },
      { dataIndex: 'sap_create_old', title: 'SAP Code' },
    ],
  },
  'mandatory-grid': {
    title: 'Mandatory Grid (Field Visibility per Major Category)',
    description: 'All rows currently stored in maj_cat_mandatory_grid.',
    rowKey: 'id',
    defaultSortBy: 'id',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'major_category', title: 'Major Category' },
      { dataIndex: 'div', title: 'Division' },
      { dataIndex: 'sub_div', title: 'Sub Division' },
      { dataIndex: 'sap_key', title: 'SAP Key' },
      { dataIndex: 'label', title: 'Label' },
      { dataIndex: 'is_active', title: 'Active', type: 'boolean' },
      { dataIndex: 'uploaded_at', title: 'Uploaded At', type: 'date', editable: false },
    ],
  },
  'segment-master': {
    title: 'Segment Master (Price Segments per Major Category)',
    description: 'All rows currently stored in maj_cat_segment.',
    rowKey: 'id',
    defaultSortBy: 'id',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'id', title: 'ID', width: 80, editable: false },
      { dataIndex: 'sub_division', title: 'Sub Division' },
      { dataIndex: 'major_category', title: 'Major Category' },
      { dataIndex: 'segment_type', title: 'Segment Type' },
      { dataIndex: 'min', title: 'Min' },
      { dataIndex: 'max', title: 'Max' },
      { dataIndex: 'created_at', title: 'Created At', type: 'date', editable: false },
      { dataIndex: 'updated_at', title: 'Updated At', type: 'date', editable: false },
    ],
  },
  'fabric-article-data': {
    title: 'Fabric Article Data (Bulk Insert)',
    description: 'All rows currently stored in fabric_article_data.',
    rowKey: 'id',
    defaultSortBy: 'createdAt',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'fabricArticleNumber', title: 'Fabric Article No.' },
      { dataIndex: 'fabricArticleDescription', title: 'Description' },
      { dataIndex: 'division', title: 'Division' },
      { dataIndex: 'subDivision', title: 'Sub Division' },
      { dataIndex: 'majorCategory', title: 'Major Category' },
      { dataIndex: 'vendorName', title: 'Vendor Name' },
      { dataIndex: 'vendorCode', title: 'Vendor Code' },
      { dataIndex: 'mFabDiv', title: 'Fab Div' },
      { dataIndex: 'mYarn', title: 'Yarn' },
      { dataIndex: 'mConstruction', title: 'Construction' },
      { dataIndex: 'mGsm', title: 'GSM' },
      { dataIndex: 'mComposition', title: 'Composition' },
      { dataIndex: 'approvalStatus', title: 'Approval Status', editable: false },
      { dataIndex: 'sapSyncStatus', title: 'SAP Sync Status', editable: false },
      { dataIndex: 'userName', title: 'Uploaded By', editable: false },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
    ],
  },
  'fabric-article-master': {
    title: 'Fabric Article Master (Fabric Hierarchy)',
    description: 'All rows currently stored in fabric_article_master.',
    rowKey: 'id',
    defaultSortBy: 'createdAt',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'seg', title: 'Segment' },
      { dataIndex: 'div', title: 'Division' },
      { dataIndex: 'subDiv', title: 'Sub Division' },
      { dataIndex: 'majCat', title: 'Major Category' },
      { dataIndex: 'mcCode', title: 'MC Code' },
      { dataIndex: 'mcDes', title: 'MC Description' },
      { dataIndex: 'status', title: 'Status' },
      { dataIndex: 'hsnCd', title: 'HSN Code' },
      { dataIndex: 'artType', title: 'Article Type' },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
    ],
  },
  'national-grid': {
    title: 'National Grid (Attribute Values)',
    description: 'All rows currently stored in national_grid_master.',
    rowKey: 'id',
    defaultSortBy: 'createdAt',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'attributeName', title: 'Attribute Name' },
      { dataIndex: 'code', title: 'Code' },
      { dataIndex: 'fullForm', title: 'Full Form' },
      { dataIndex: 'isActive', title: 'Active', type: 'boolean' },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
    ],
  },
  hierarchy: {
    title: 'Hierarchy (Division / Sub-Division / Major Category)',
    description: 'Flattened view of departments → sub_departments → categories. Editing here only changes a category’s own fields, not the tree structure.',
    rowKey: 'major_category_code',
    defaultSortBy: 'division',
    defaultSortDir: 'asc',
    columns: [
      { dataIndex: 'division_code', title: 'Division Code', editable: false },
      { dataIndex: 'division', title: 'Division', editable: false },
      { dataIndex: 'sub_division_code', title: 'Sub Division Code', editable: false },
      { dataIndex: 'sub_division', title: 'Sub Division', editable: false },
      { dataIndex: 'major_category_code', title: 'Major Category Code', editable: false },
      { dataIndex: 'major_category', title: 'Major Category' },
      { dataIndex: 'mc_code', title: 'MC Code' },
      { dataIndex: 'mc_des', title: 'MC Description' },
      { dataIndex: 'fabric_division', title: 'Fabric Division' },
      { dataIndex: 'garment_type', title: 'Garment Type', editable: false },
      { dataIndex: 'is_active', title: 'Active', type: 'boolean' },
    ],
  },
  'body-article-data': {
    title: 'Body Article Data (Bulk Update)',
    description: 'All rows currently stored in body_article_data.',
    rowKey: 'id',
    defaultSortBy: 'createdAt',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'bodyArticleNumber', title: 'Body Article No.' },
      { dataIndex: 'bodyArticleDescription', title: 'Description' },
      { dataIndex: 'division', title: 'Division' },
      { dataIndex: 'subDivision', title: 'Sub Division' },
      { dataIndex: 'majorCategory', title: 'Major Category' },
      { dataIndex: 'mcCode', title: 'MC Code' },
      { dataIndex: 'articleNumber', title: 'Article Number' },
      { dataIndex: 'vendorName', title: 'Vendor Name' },
      { dataIndex: 'approvalStatus', title: 'Approval Status', editable: false },
      { dataIndex: 'sapSyncStatus', title: 'SAP Sync Status', editable: false },
      { dataIndex: 'userName', title: 'Uploaded By', editable: false },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
    ],
  },
  'raw-articles': {
    title: 'Raw Articles (SRM Pipeline)',
    description: 'All rows currently stored in raw_articles. Read-only — this is a sync-pipeline staging table, so edits here would just be overwritten by the next sync.',
    rowKey: 'id',
    defaultSortBy: 'createdAt',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'presentationNo', title: 'Presentation No.', editable: false },
      { dataIndex: 'vendorCode', title: 'Vendor Code', editable: false },
      { dataIndex: 'vendorName', title: 'Vendor Name', editable: false },
      { dataIndex: 'division', title: 'Division', editable: false },
      { dataIndex: 'subDivision', title: 'Sub Division', editable: false },
      { dataIndex: 'majorCategory', title: 'Major Category', editable: false },
      { dataIndex: 'designNumber', title: 'Design Number', editable: false },
      { dataIndex: 'articleNumber', title: 'Article Number', editable: false },
      { dataIndex: 'status', title: 'Status', editable: false },
      { dataIndex: 'source', title: 'Source', editable: false },
      { dataIndex: 'createdAt', title: 'Created At', type: 'date', editable: false },
    ],
  },
  'vendor-master': {
    title: 'Vendor Master (DAB Sync)',
    description: 'All rows currently stored in master_vendor_details. Read-only — synced automatically from the DAB vendor master, so edits here would just be overwritten by the next sync.',
    rowKey: 'id',
    defaultSortBy: 'syncedAt',
    defaultSortDir: 'desc',
    columns: [
      { dataIndex: 'vendorCode', title: 'Vendor Code', editable: false },
      { dataIndex: 'vendorName', title: 'Vendor Name', editable: false },
      { dataIndex: 'vendorCity', title: 'Vendor City', editable: false },
      { dataIndex: 'vendorRegion', title: 'Vendor Region', editable: false },
      { dataIndex: 'mergeVendorCode', title: 'Merge Vendor Code', editable: false },
      { dataIndex: 'mergeVendorName', title: 'Merge Vendor Name', editable: false },
      { dataIndex: 'syncedAt', title: 'Synced At', type: 'date', editable: false },
    ],
  },
};
