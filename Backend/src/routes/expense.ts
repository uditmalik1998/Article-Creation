/**
 * Expense Data routes — outside the ADMIN-only /api/admin mount so the
 * sub-division editors and approval-chain users who drive the change-request
 * workflow can reach them too.
 *
 * Read access stays role-based (plus anyone holding a grant). Raising an
 * add / edit / delete is gated per-email by `expense_access_grants`
 * (services/expenseAccessService.ts); each stage of the approval chain is
 * gated inside the controller, which is the first place the request's
 * current stage and table key are both known. ADMIN bypasses all of it.
 */

import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as expenseChangeRequestController from '../controllers/expenseChangeRequestController';
import * as expenseAccessController from '../controllers/expenseAccessController';
import { requireExpenseView, requireExpenseOperation } from '../middleware/expenseAccess';
import { asyncHandler } from '../middleware/asyncHandler';

const h = asyncHandler;
const router = Router();

// What the caller themselves may do — drives which buttons the UI renders.
router.get('/my-access', h(expenseAccessController.getMyExpenseAccess));

router.get('/table/:tableKey', h(requireExpenseView), h(adminController.getExpenseTableData));

// ORDER MATTERS: /table/:tableKey/add-requests must be registered before
// /table/:tableKey/:rowId/... so "add-requests" isn't read as a rowId.
router.post(
  '/table/:tableKey/add-requests',
  h(requireExpenseOperation('create')),
  h(expenseChangeRequestController.createExpenseAddRequest)
);
router.post(
  '/table/:tableKey/:rowId/change-requests',
  h(requireExpenseOperation('update')),
  h(expenseChangeRequestController.createExpenseChangeRequest)
);
router.post(
  '/table/:tableKey/:rowId/delete-requests',
  h(requireExpenseOperation('delete')),
  h(expenseChangeRequestController.createExpenseDeleteRequest)
);

// ORDER MATTERS: /change-requests must come before /change-requests/:id would interfere
router.get('/change-requests', h(requireExpenseView), h(expenseChangeRequestController.getExpenseChangeRequests));
router.get('/change-requests/:id', h(requireExpenseView), h(expenseChangeRequestController.getExpenseChangeRequestById));
// One endpoint for every stage of the chain — which stage a request is
// waiting on, and whether the caller may act on it, are resolved inside the
// controller (the chain's length is admin-configurable, so there's no fixed
// "stage 2" to hang a separate route off).
router.post('/change-requests/:id/act', h(expenseChangeRequestController.actOnExpenseChangeRequest));

export default router;
