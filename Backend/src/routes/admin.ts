/**
 * Admin Routes - Complete Hierarchy Management
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as adminController from '../controllers/adminController';
import { hierarchyService } from '../services/hierarchyService';
import { asyncHandler } from '../middleware/asyncHandler';
import multer from 'multer';

// Memory storage multer instance for Excel uploads (max 50 MB)
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.xls')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx / .xls) are allowed'));
    }
  },
});

const h = asyncHandler;

const router = Router();

// Invalidate hierarchy cache after any mutating call on hierarchy endpoints
const invalidateHierarchyCache = (_req: Request, res: Response, next: NextFunction) => {
  const orig = res.json.bind(res);
  res.json = (body: any) => {
    if (res.statusCode < 400) {
      hierarchyService.invalidate();
      adminController.clearAllHierarchyCaches();
    }
    return orig(body);
  };
  next();
};
const mut = invalidateHierarchyCache;

// ═══════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════
router.get('/stats', h(adminController.getDashboardStats));

// ═══════════════════════════════════════════════════════
// ANALYTICS (EXPENSES & IMAGE USAGE)
// ═══════════════════════════════════════════════════════
router.get('/analytics/expenses', h(adminController.getExpenseAnalytics));
router.get('/analytics/expenses/detailed', h(adminController.getDetailedExpenses));
router.get('/analytics/image-usage', h(adminController.getImageUsageAnalytics));

// ═══════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════
router.get('/departments', h(adminController.getAllDepartments));
router.get('/departments/:id', h(adminController.getDepartmentById));
router.post('/departments', mut, h(adminController.createDepartment));
router.put('/departments/:id', mut, h(adminController.updateDepartment));
router.delete('/departments/:id', mut, h(adminController.deleteDepartment));

// ═══════════════════════════════════════════════════════
// SUB-DEPARTMENTS
// ═══════════════════════════════════════════════════════
router.get('/sub-departments', h(adminController.getAllSubDepartments));
router.get('/sub-departments/:id', h(adminController.getSubDepartmentById));
router.post('/sub-departments', mut, h(adminController.createSubDepartment));
router.put('/sub-departments/:id', mut, h(adminController.updateSubDepartment));
router.delete('/sub-departments/:id', mut, h(adminController.deleteSubDepartment));

// ═══════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════
router.get('/categories', h(adminController.getAllCategories));
router.get('/categories/:id', h(adminController.getCategoryById));
router.get('/categories/:id/all-attributes', h(adminController.getCategoryWithAllAttributes));
router.get('/categories/:code/attributes', h(adminController.getCategoryByCode));
router.post('/categories', mut, h(adminController.createCategory));
router.put('/categories/:id', mut, h(adminController.updateCategory));
router.delete('/categories/:id', mut, h(adminController.deleteCategory));
router.put('/categories/:id/attributes', mut, h(adminController.updateCategoryAttributes));
router.put('/categories/:categoryId/attributes/:attributeId', mut, h(adminController.updateCategoryAttributeMapping));
router.post('/categories/:categoryId/attributes', mut, h(adminController.addAttributeToCategory));
router.delete('/categories/:categoryId/attributes/:attributeId', mut, h(adminController.removeAttributeFromCategory));

// ═══════════════════════════════════════════════════════
// MASTER ATTRIBUTES
// ═══════════════════════════════════════════════════════
router.get('/attributes', h(adminController.getAllMasterAttributes));
router.get('/attributes/:id', h(adminController.getMasterAttributeById));
router.post('/attributes', mut, h(adminController.createMasterAttribute));
router.put('/attributes/:id', mut, h(adminController.updateMasterAttribute));
router.delete('/attributes/:id', mut, h(adminController.deleteMasterAttribute));
router.post('/attributes/:id/values', mut, h(adminController.addAllowedValue));
router.delete('/attributes/:id/values/:valueId', mut, h(adminController.deleteAllowedValue));

// ═══════════════════════════════════════════════════════
// HIERARCHY
// ═══════════════════════════════════════════════════════
router.get('/hierarchy/tree', h(adminController.getHierarchyTree));
router.get('/hierarchy/tree/lightweight', h(adminController.getHierarchyTreeLightweight));
router.post('/hierarchy/tree/cache/clear', h(adminController.invalidateHierarchyCache));
router.get('/hierarchy/export', h(adminController.exportHierarchy));

// ═══════════════════════════════════════════════════════
// USERS (ADMIN ONLY)
// ═══════════════════════════════════════════════════════
router.get('/users', h(adminController.getAllUsers));
router.post('/users', h(adminController.createUser));
router.put('/users/:id', h(adminController.updateUser));
router.delete('/users/:id', h(adminController.deactivateUser));

// ═══════════════════════════════════════════════════════
// EXTRACTIONS (ADMIN ONLY)
// ═══════════════════════════════════════════════════════
router.get('/extractions', h(adminController.getAllExtractions));

// ═══════════════════════════════════════════════════════
// SRM SYNC (ADMIN)
// ═══════════════════════════════════════════════════════
router.get('/srm/status', h(adminController.getSrmSyncStatus));
router.post('/srm/sync', h(adminController.triggerSrmSync));
router.post('/srm/enrich', h(adminController.triggerSrmEnrichment));
router.post('/srm/sync-by-ref', h(adminController.syncSrmByRef));

// ═══════════════════════════════════════════════════════
// SRM FAILED EXTRACTIONS (ADMIN)
// ═══════════════════════════════════════════════════════
// ORDER MATTERS: retry-all must come before :id/retry so Express
// doesn't treat "retry-all" as a record id.
router.get('/srm/failed-extractions',                  h(adminController.getSrmFailedExtractions));
router.post('/srm/failed-extractions/retry-all',       h(adminController.retrySrmFailedAll));
router.post('/srm/failed-extractions/:id/retry',       h(adminController.retrySrmFailedRecord));

// ═══════════════════════════════════════════════════════
// VENDOR MASTER SYNC (ADMIN)
// ═══════════════════════════════════════════════════════
router.get('/vendor-master/status', h(adminController.getVendorMasterSyncStatus));
router.post('/vendor-master/sync', h(adminController.triggerVendorMasterSync));

// ═══════════════════════════════════════════════════════
// MAJ-CAT GRID (ADMIN)
// ═══════════════════════════════════════════════════════
router.get('/majcat-grid/status', h(adminController.getMajCatGridStatus));
router.get('/majcat-grid/values', h(adminController.getMajCatGridValues));
router.get('/majcat-grid/template', h(adminController.downloadMajCatGridTemplate));
router.post('/majcat-grid/upload', excelUpload.single('file'), h(adminController.uploadMajCatGrid));
router.get('/majcat-grid/upload-status/:jobId', h(adminController.getMajCatGridUploadStatus));

// ═══════════════════════════════════════════════════════
// MANDATORY GRID (ADMIN)
// ═══════════════════════════════════════════════════════
router.get('/mandatory-grid/status', h(adminController.getMandatoryGridStatus));
router.get('/mandatory-grid/values', h(adminController.getMandatoryGridValues));
router.get('/mandatory-grid/template', h(adminController.downloadMandatoryGridTemplate));
router.post('/mandatory-grid/upload', excelUpload.single('file'), h(adminController.uploadMandatoryGrid));

// ═══════════════════════════════════════════════════════
// SIZE MASTER (ADMIN) — maj_cat_sizes
// ═══════════════════════════════════════════════════════
router.get('/size-master/status', h(adminController.getSizeMasterStatus));
router.get('/size-master/template', h(adminController.downloadSizeMasterTemplate));
router.post('/size-master/upload', excelUpload.single('file'), h(adminController.uploadSizeMaster));

// ═══════════════════════════════════════════════════════
// COLOR MASTER (ADMIN) — color_master
// ═══════════════════════════════════════════════════════
router.get('/color-master/status', h(adminController.getColorMasterStatus));
router.get('/color-master/template', h(adminController.downloadColorMasterTemplate));
router.post('/color-master/upload', excelUpload.single('file'), h(adminController.uploadColorMaster));

// ═══════════════════════════════════════════════════════
// SEGMENT MASTER (ADMIN) — maj_cat_segment
// ═══════════════════════════════════════════════════════
router.get('/segment-master/status', h(adminController.getSegmentMasterStatus));
router.get('/segment-master/template', h(adminController.downloadSegmentMasterTemplate));
router.get('/segment-master/export', h(adminController.exportSegmentMaster));
router.post('/segment-master/upload', excelUpload.single('file'), h(adminController.uploadSegmentMaster));

// ═══════════════════════════════════════════════════════
// GRID VALUES EDITOR (ADMIN) — maj_cat_grid_values
// Group → Attribute → Major Category browser + per-value add/delete.
// POST used for mutations to avoid the Express 5 DELETE registration quirk.
// ═══════════════════════════════════════════════════════
router.get('/grid-values/attributes', h(adminController.getGridValueAttributes));
router.get('/grid-values/categories', h(adminController.getGridValueCategories));
router.get('/grid-values/values', h(adminController.getGridValues));
router.get('/grid-values/audit', h(adminController.getGridValueAudit));
router.post('/grid-values/add', h(adminController.addGridValue));
router.post('/grid-values/delete', h(adminController.deleteGridValue));

// Status dashboard — generic-article counts by status, grouped division → sub-division
router.get('/status-dashboard', h(adminController.getStatusDashboard));

// Size Master editor (maj_cat_sizes) — browse per major category, add/remove with audit
router.get('/size-master/categories', h(adminController.getSizeMasterCategories));
router.get('/size-master/sizes', h(adminController.getSizeMasterSizes));
router.get('/size-master/audit', h(adminController.getSizeMasterAudit));
router.post('/size-master/add', h(adminController.addSizeMasterSize));
router.post('/size-master/delete', h(adminController.deleteSizeMasterSize));

// ═══════════════════════════════════════════════════════
// HIERARCHY EXCEL UPLOAD (ADMIN)
// Upserts Department / SubDepartment / Category from
// DIV / SUB-DIV / MAJOR_CATEGORY columns of the Mandatory Grid Excel.
// ═══════════════════════════════════════════════════════
router.get('/hierarchy/excel-status', h(adminController.getHierarchyExcelStatus));
router.post('/hierarchy/upload-excel', excelUpload.single('file'), mut, h(adminController.uploadHierarchyExcel));

// ═══════════════════════════════════════════════════════
// MODIFY LOGS (ADMIN)
// ═══════════════════════════════════════════════════════
// ORDER MATTERS: group/:groupId must come before plain :id would interfere
router.get('/modify-logs/group/:groupId', h(adminController.getModifyLogsByGroup));
router.get('/modify-logs',               h(adminController.getModifyLogs));

router.get('/national-grid',             h(adminController.getNationalGrid));
router.post('/national-grid/import',     h(adminController.importNationalGrid));

// NOTE: Expense Data read/edit-workflow routes moved to routes/expense.ts,
// mounted at /api/expense (not ADMIN-only), so Creator/Approver/Category-Head/PD
// can reach them too.

// ═══════════════════════════════════════════════════════
// FABRIC ARTICLE DATA (ADMIN) — fabric_article_data
// ═══════════════════════════════════════════════════════
router.get('/fabric-article-data/status',   h(adminController.getFabricArticleDataStatus));
router.get('/fabric-article-data/template', h(adminController.downloadFabricArticleDataTemplate));
router.post('/fabric-article-data/upload',  excelUpload.single('file'), h(adminController.uploadFabricArticleData));

// ═══════════════════════════════════════════════════════
// FABRIC ARTICLE MASTER (ADMIN) — fabric_article_master
// ═══════════════════════════════════════════════════════
router.get('/fabric-article-master/status',   h(adminController.getFabricArticleMasterStatus));
router.get('/fabric-article-master/template', h(adminController.downloadFabricArticleMasterTemplate));
router.post('/fabric-article-master/upload',  excelUpload.single('file'), h(adminController.uploadFabricArticleMaster));

// ═══════════════════════════════════════════════════════
// BODY ARTICLE DATA (ADMIN) — body_article_data
// ═══════════════════════════════════════════════════════
router.get('/body-article-data/status',   h(adminController.getBodyArticleDataStatus));
router.get('/body-article-data/template', h(adminController.downloadBodyArticleDataTemplate));
router.post('/body-article-data/upload',  excelUpload.single('file'), h(adminController.uploadBodyArticleData));

export default router;
