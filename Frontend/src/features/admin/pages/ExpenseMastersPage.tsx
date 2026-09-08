import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, Eye, TableIcon } from 'lucide-react';
import { Button, Card, CardContent } from '@/shared/components/ui-tw';
import { getMyExpenseAccess } from '../../../services/adminApi';
import { EXPENSE_TABLE_CONFIGS } from '../config/expenseTables';

/**
 * The non-admin entry point into Expense Data: every master table, as a
 * plain name + "View Data" link — no upload/template/status controls, which
 * stay on the full Admin → Expenses page. Add/edit/delete happen on the
 * table detail page each card links to, gated there per the viewer's own
 * access (role-based requester rights, or an explicit grant).
 */
export default function ExpenseMastersPage() {
  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ['my-expense-access', undefined],
    queryFn: () => getMyExpenseAccess(),
    staleTime: 60_000,
  });

  if (!accessLoading && access && !access.canView) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You don't have access to Expense Data. Ask an admin to grant your email address access on
            Admin → Expense Access Control.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Link
          to="/admin/expense-change-requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ClipboardList className="h-4 w-4" /> My Change Requests
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Expense Data</h1>
        <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
          Every master table behind the Expense pages. Open one to browse it, or to propose an add, edit or delete —
          each proposal needs a reason and a date, then goes through approval before it changes anything.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(EXPENSE_TABLE_CONFIGS).map(([key, cfg]) => (
          <Card key={key} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-2 pt-4">
              <div className="flex items-start gap-2">
                <TableIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-semibold leading-tight">{cfg.title.split(' (')[0]}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{cfg.description}</p>
                </div>
              </div>
              <div className="mt-auto pt-2">
                <Link to={`/admin/expense/${key}`}>
                  <Button size="sm" variant="outline" className="w-full">
                    <Eye className="h-4 w-4" />
                    View Data
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
