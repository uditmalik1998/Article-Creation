/**
 * Route guards for the Expense Data change workflow.
 *
 * Viewing the tables stays role-based (unchanged), but *raising* a change is
 * gated on a per-email grant from `expense_access_grants` — see
 * services/expenseAccessService.ts. ADMIN bypasses every check.
 *
 * The two approval stages are NOT guarded here: `review`/`finalize` are
 * addressed by request id, so their table key is only known once the request
 * has been loaded. Those checks live in expenseChangeRequestController.
 */

import { Request, Response, NextFunction } from 'express';
import { getExpenseAccess } from '../services/expenseAccessService';

type Operation = 'create' | 'update' | 'delete';

const OPERATION_LABEL: Record<Operation, string> = {
  create: 'add new rows to',
  update: 'edit rows in',
  delete: 'delete rows from',
};

/** Read-only browse: one of the historic view roles, or any active grant —
 * `canView` folds both in. */
export async function requireExpenseView(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required.', code: 'NOT_AUTHENTICATED' });
    return;
  }

  const access = await getExpenseAccess(req.user, req.params.tableKey);
  if (!access.canView) {
    res.status(403).json({
      success: false,
      error: 'You do not have access to Grid Data. Ask an admin to grant your email address access.',
      code: 'NO_EXPENSE_ACCESS',
    });
    return;
  }
  next();
}

/**
 * Raising an add / edit / delete request on `req.params.tableKey`. Requires a
 * SUB_DIVISION grant for that table (or ADMIN) with the operation enabled.
 */
export function requireExpenseOperation(operation: Operation) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.', code: 'NOT_AUTHENTICATED' });
      return;
    }

    const access = await getExpenseAccess(req.user, req.params.tableKey);
    const allowed =
      operation === 'create' ? access.canCreate : operation === 'update' ? access.canUpdate : access.canDelete;

    if (!allowed) {
      res.status(403).json({
        success: false,
        error: `You are not allowed to ${OPERATION_LABEL[operation]} this table. Ask an admin to grant your email address sub-division access.`,
        code: 'NO_EXPENSE_ACCESS',
      });
      return;
    }

    // A request is routed to the Category Head of the requester's own
    // Business Division (captured on the request at creation). With none set
    // it would reach no Category Head at all, so it is refused up front —
    // ADMIN excepted (2026-11-24).
    if (String(req.user.role) !== 'ADMIN' && !req.user.businessDivision) {
      res.status(403).json({
        success: false,
        error: 'Your Business Division is not set, so this request could not reach a Category Head. Ask an admin to set it on the Users page, then try again.',
        code: 'NO_BUSINESS_DIVISION',
      });
      return;
    }
    next();
  };
}
