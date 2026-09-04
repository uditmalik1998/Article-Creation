/**
 * Expense Data routes — outside the ADMIN-only /api/admin mount so
 * Creator/Approver/Category-Head/PD can reach the read view and the
 * change-request workflow too. Each route still checks the caller's
 * specific role via `requireRole`.
 */

import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as expenseChangeRequestController from '../controllers/expenseChangeRequestController';
import { requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const h = asyncHandler;
const router = Router();

const VIEW_ROLES = ['ADMIN', 'CREATOR', 'APPROVER', 'CATEGORY_HEAD', 'PD'];
const CREATE_ROLES = ['ADMIN', 'CREATOR'];
const REVIEW_ROLES = ['ADMIN', 'APPROVER'];
const FINALIZE_ROLES = ['ADMIN', 'CATEGORY_HEAD', 'PD'];

router.get('/table/:tableKey', requireRole(...VIEW_ROLES), h(adminController.getExpenseTableData));

router.post(
  '/table/:tableKey/:rowId/change-requests',
  requireRole(...CREATE_ROLES),
  h(expenseChangeRequestController.createExpenseChangeRequest)
);

// ORDER MATTERS: /change-requests must come before /change-requests/:id would interfere
router.get('/change-requests', requireRole(...VIEW_ROLES), h(expenseChangeRequestController.getExpenseChangeRequests));
router.get('/change-requests/:id', requireRole(...VIEW_ROLES), h(expenseChangeRequestController.getExpenseChangeRequestById));
router.post('/change-requests/:id/review', requireRole(...REVIEW_ROLES), h(expenseChangeRequestController.reviewExpenseChangeRequest));
router.post('/change-requests/:id/finalize', requireRole(...FINALIZE_ROLES), h(expenseChangeRequestController.finalizeExpenseChangeRequest));

export default router;
