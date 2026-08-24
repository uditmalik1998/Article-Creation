import { Router } from 'express';
import multer from 'multer';
import { ApproverController } from '../controllers/ApproverController';
import { authenticate, requireApprover, requireApprovalRights } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const h = asyncHandler; // shorthand — wraps every handler so unhandled errors become 500s

// In-memory multer for image uploads (per-color variant images). 15MB cap, images only.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '15728640', 10) },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Only JPEG/PNG/WEBP images are allowed'));
  },
});

// Apply middleware to all routes
router.use(authenticate);
router.use(requireApprover);

// Get attributes for dropdowns
router.get('/attributes', h(ApproverController.getAttributes));

// Get items for dashboard
router.get('/items', h(ApproverController.getItems));

// Export ALL items matching current filters (capped at 10k rows)
router.get('/items/export-all', h(ApproverController.exportAll));

// Export ALL items with SAP-created variants interleaved (generic row then its variant rows)
router.get('/items/export-all-with-variants', h(ApproverController.exportAllWithVariants));

// Get / Update / Delete a specific item
// router.all used because Express 5 DELETE registration has a matching quirk in this setup
router.all('/items/:id', h(async (req, res, next) => {
  if (req.method === 'GET')    return ApproverController.getById(req, res);
  if (req.method === 'PUT')    return ApproverController.updateItem(req, res);
  if (req.method === 'DELETE') return ApproverController.deleteItem(req, res);
  next();
  return;
}));

// Validate changes against National Grid without touching SAP or the DB.
router.post('/items/:id/validate-modify', h(ApproverController.validateModify));

// Modify an already-created (SAP-synced) article: pushes attribute changes to
// SAP via patch-bulk, then persists locally only on success.
router.post('/items/:id/modify', requireApprovalRights, h(ApproverController.modifyItem));

// FINAL submit — creates the article in SAP.
router.post('/approve', requireApprovalRights, h(ApproverController.approveItems));

// Reject selected items — approver roles + PD + ADMIN
router.post('/reject', requireApprovalRights, h(ApproverController.rejectItems));

// Refresh image URL (fixes expired signed URLs)
router.get('/image/:id', h(ApproverController.getImageUrl));

// Variant routes
router.get('/items/:id/variants', h(ApproverController.getVariants));
router.post('/items/:id/add-color', h(ApproverController.addColor));
router.post('/items/:id/ensure-color-variants', h(ApproverController.ensureColorVariants));
// Upload a per-color variant image → returns { url }
router.post('/upload-image', imageUpload.single('image'), h(ApproverController.uploadImage));
router.post('/items/:id/duplicate', h(ApproverController.duplicateItem));
router.post('/items/:id/sync-color', h(ApproverController.syncColorToVariants));
router.post('/items/:id/retry-variants', h(ApproverController.retryVariants));
// Re-queue FAILED generics for the background SAP-sync worker (async approval flow)
router.post('/retry-sap-sync', requireApprovalRights, h(ApproverController.retrySapSync));

// Vendor name search — returns up to 15 matching vendors from master_vendor_details
router.get('/vendor-search', h(ApproverController.vendorSearch));

// Fabric article data search — returns up to 15 matching fabric_article_data rows by number or description
router.get('/fabric-article-data/search', h(ApproverController.searchFabricArticleData));

// Sizes for a given major category (from maj_cat_sizes table)
router.get('/sizes-for-majcat/:majCat', h(ApproverController.getSizesForMajCat));

// Color master list for the Add Color Variants dropdown (from color_master table)
router.get('/colors', h(ApproverController.getColorMaster));

// BOM grid Art # lookup — returns { attrName: { mvgrValue: sapCd } } for a major category
router.get('/bom-art-numbers/:majCat', h(ApproverController.getBomArtNumbers));

// Admin: backfill article descriptions for a date range
// POST /api/approver/backfill-descriptions?fromDate=2026-04-10&toDate=2026-04-16
router.post('/backfill-descriptions', h(ApproverController.backfillDescriptions));

// Cascading Division → Sub-Division → Major Category hierarchy from fabric_article_master
router.get('/fabric-article-master/hierarchy', h(ApproverController.getFabricArticleMasterHierarchy));

// Fabric attribute grid values from fabric_maj_cat_grid_values (M_FAB_DIV, M_YARN, etc.)
router.get('/fabric-grid-values', h(ApproverController.getFabricGridValues));

// Body attribute grid values from national_grid_master (M_COLLAR_TYPE, M_NO_OF_POCKET, etc.)
router.get('/national-grid-values', h(ApproverController.getNationalGridValues));

export default router;
