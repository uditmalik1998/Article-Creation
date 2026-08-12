import { Router } from 'express';
import { getFieldConfigs, getAttributeValues, getCategoryAttributeConfig, getSegmentRanges } from '../controllers/articleConfigController';
import { getMajCatGridValues, getMandatoryGridValues } from '../controllers/adminController';

const router = Router();

router.get('/fields', getFieldConfigs);
router.get('/values', getAttributeValues);
router.get('/category-attributes/:code', getCategoryAttributeConfig);

// Read-only grid value endpoints — accessible to all authenticated users (not admin-only).
// These are the same data as /api/admin/majcat-grid/values and /api/admin/mandatory-grid/values
// but served via the /api/article-config route which has no requireAdmin middleware.
router.get('/majcat-grid', getMajCatGridValues);
router.get('/mandatory-grid', getMandatoryGridValues);
router.get('/segment-ranges', getSegmentRanges);

export default router;
