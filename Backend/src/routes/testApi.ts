/**
 * Test API Routes
 *
 * Endpoints for the raw_articles ingestion + extraction pipeline.
 * All routes secured with admin auth (JWT + admin role).
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  fetchPresentationToRaw,
  fetchByPptNo,
  runExtraction,
  getPipelineStatus,
  getRawArticles,
  getFabricRawStatus,
  runFabricRawProcessing,
} from '../controllers/testApiController';

const router = Router();

/**
 * POST /api/test-api/fetch-presentation
 * Body: { "after_date": "2026-05-27" }
 * Fetches ALL SRM presentations with received_date >= after_date → raw_articles (PENDING).
 */
router.post('/fetch-presentation', asyncHandler(fetchPresentationToRaw));

/**
 * POST /api/test-api/fetch-by-ppt
 * Body: { "ppt_no": "PRES-00831" }
 * Fetches a single presentation by PPT number → raw_articles (PENDING).
 */
router.post('/fetch-by-ppt', asyncHandler(fetchByPptNo));

/**
 * POST /api/test-api/run-extraction
 * Triggers the extraction worker (claims PENDING/FAILED, runs VLM, pushes to flat table).
 */
router.post('/run-extraction', asyncHandler(runExtraction));

/**
 * GET /api/test-api/pipeline-status
 * Returns raw_articles counts grouped by status.
 */
router.get('/pipeline-status', asyncHandler(getPipelineStatus));

/**
 * GET /api/test-api/raw-articles?ppt_no=PRES-00831
 * Lists raw_articles rows (optionally filtered by ppt_no).
 */
router.get('/raw-articles', asyncHandler(getRawArticles));

/**
 * GET /api/test-api/fabric-raw-pipeline-status
 * Returns fabric_raw_data counts grouped by status.
 */
router.get('/fabric-raw-pipeline-status', asyncHandler(getFabricRawStatus));

/**
 * POST /api/test-api/run-fabric-raw-processing
 * Triggers the fabric_raw_data → fabric_article_data processing worker.
 */
router.post('/run-fabric-raw-processing', asyncHandler(runFabricRawProcessing));

export default router;
