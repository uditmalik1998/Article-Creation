import { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Search, Download, ChevronRight, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tag,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  getModifyLogs,
  getModifyLogsByGroup,
  type ModifyLog,
  type ModifyLogsParams,
} from '../../../services/adminApi';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTs(ts: string): string {
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

function SapStatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'SUCCESS';
  return (
    <Badge
      className={
        isSuccess
          ? 'bg-green-100 text-green-700 border-green-200'
          : 'bg-red-100 text-red-700 border-red-200'
      }
    >
      {status}
    </Badge>
  );
}

// ─── Filter state type ────────────────────────────────────────────────────────

interface FilterState {
  search: string;
  articleNumber: string;
  labelName: string;
  modifiedByName: string;
  modifiedByEmail: string;
  sapStatus: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  articleNumber: '',
  labelName: '',
  modifiedByName: '',
  modifiedByEmail: '',
  sapStatus: '',
  dateFrom: '',
  dateTo: '',
};

// ─── Detail Dialog ─────────────────────────────────────────────────────────────

interface DetailDialogProps {
  groupId: string | null;
  onClose: () => void;
}

function DetailDialog({ groupId, onClose }: DetailDialogProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['modify-logs-group', groupId],
    queryFn: () => getModifyLogsByGroup(groupId!),
    enabled: !!groupId,
  });

  const logs = data?.data ?? [];

  return (
    <Dialog open={!!groupId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Modification Group Details</DialogTitle>
          {groupId && (
            <p className="text-xs text-muted-foreground font-mono break-all">{groupId}</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-auto mt-2">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Spinner size="md" />
            </div>
          )}
          {isError && (
            <p className="text-center text-red-500 py-6 text-sm">Failed to load group details.</p>
          )}
          {!isLoading && !isError && logs.length === 0 && (
            <p className="text-center text-muted-foreground py-6 text-sm">No records found.</p>
          )}
          {!isLoading && logs.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Old Value</TableHead>
                  <TableHead>New Value</TableHead>
                  <TableHead>SAP Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Tag className="font-mono text-xs">{log.labelName}</Tag>
                    </TableCell>
                    <TableCell>
                      <span className="text-red-600 text-sm">
                        {log.oldValue ?? <span className="text-muted-foreground italic">—</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-green-600 text-sm">
                        {log.newValue ?? <span className="text-muted-foreground italic">—</span>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <SapStatusBadge status={log.sapStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ModificationLogsPage() {
  const [page, setPage] = useState(1);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // ── Query ──────────────────────────────────────────────────────────────────

  const queryParams: ModifyLogsParams = {
    page,
    limit: PAGE_SIZE,
    ...(appliedFilters.search && { search: appliedFilters.search }),
    ...(appliedFilters.articleNumber && { articleNumber: appliedFilters.articleNumber }),
    ...(appliedFilters.labelName && { labelName: appliedFilters.labelName }),
    ...(appliedFilters.modifiedByName && { modifiedByName: appliedFilters.modifiedByName }),
    ...(appliedFilters.modifiedByEmail && { modifiedByEmail: appliedFilters.modifiedByEmail }),
    ...(appliedFilters.sapStatus && { sapStatus: appliedFilters.sapStatus }),
    ...(appliedFilters.dateFrom && { dateFrom: appliedFilters.dateFrom }),
    ...(appliedFilters.dateTo && { dateTo: appliedFilters.dateTo }),
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['modify-logs', queryParams],
    queryFn: () => getModifyLogs(queryParams),
    placeholderData: keepPreviousData,
  });

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;

  // ── Filter handlers ────────────────────────────────────────────────────────

  const handleDraftChange = useCallback(
    (field: keyof FilterState, value: string) => {
      setDraftFilters((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleApply = useCallback(() => {
    setPage(1);
    setAppliedFilters(draftFilters);
  }, [draftFilters]);

  const handleReset = useCallback(() => {
    setPage(1);
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const exportParams: ModifyLogsParams = {
        ...queryParams,
        page: 1,
        limit: 10000,
      };
      const result = await getModifyLogs(exportParams);
      const rows = result.data;

      if (rows.length === 0) {
        message.warning('No data to export.');
        return;
      }

      const { utils, writeFile } = await import('xlsx');

      const wsData = rows.map((r) => ({
        Time: formatTs(r.modifiedAt),
        'Article Number': r.articleNumber,
        Label: r.labelName,
        'Old Value': r.oldValue ?? '',
        'New Value': r.newValue ?? '',
        'Modified By': r.modifiedByName,
        'Modified By Email': r.modifiedByEmail,
        'SAP Status': r.sapStatus,
        'Group ID': r.modificationGroupId,
      }));

      const ws = utils.json_to_sheet(wsData);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Modification Logs');

      const fileName = `modification-logs-${dayjs().format('YYYY-MM-DD-HHmm')}.xlsx`;
      writeFile(wb, fileName);
      message.success(`Exported ${rows.length} rows to ${fileName}`);
    } catch (err) {
      console.error('Export failed:', err);
      message.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [queryParams]);

  // ── Table columns ──────────────────────────────────────────────────────────

  const columns: DataTableColumn<ModifyLog>[] = [
    {
      title: 'Time',
      key: 'modifiedAt',
      width: 160,
      render: (_v, record) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTs(record.modifiedAt)}
        </span>
      ),
    },
    {
      title: 'Article No.',
      key: 'articleNumber',
      width: 130,
      render: (_v, record) => (
        <span className="font-mono text-xs font-semibold">{record.articleNumber}</span>
      ),
    },
    {
      title: 'Label',
      key: 'labelName',
      width: 160,
      render: (_v, record) => (
        <Tag className="font-mono text-xs">{record.labelName}</Tag>
      ),
    },
    {
      title: 'Old Value',
      key: 'oldValue',
      render: (_v, record) =>
        record.oldValue ? (
          <span className="text-red-600 text-sm break-all">{record.oldValue}</span>
        ) : (
          <span className="text-muted-foreground text-sm italic">—</span>
        ),
    },
    {
      title: 'New Value',
      key: 'newValue',
      render: (_v, record) =>
        record.newValue ? (
          <span className="text-green-600 text-sm break-all">{record.newValue}</span>
        ) : (
          <span className="text-muted-foreground text-sm italic">—</span>
        ),
    },
    {
      title: 'Modified By',
      key: 'modifiedBy',
      width: 180,
      render: (_v, record) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium leading-tight">{record.modifiedByName}</span>
          <span className="text-xs text-muted-foreground">{record.modifiedByEmail}</span>
        </div>
      ),
    },
    {
      title: 'SAP Status',
      key: 'sapStatus',
      width: 110,
      align: 'center',
      render: (_v, record) => <SapStatusBadge status={record.sapStatus} />,
    },
    {
      title: '',
      key: 'action',
      width: 48,
      align: 'center',
      render: (_v, record) => (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={() => setSelectedGroupId(record.modificationGroupId)}
          title="View group details"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Modification Logs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Audit trail of all article field modifications
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || isLoading}
          className="flex items-center gap-2"
        >
          {isExporting ? (
            <Spinner size="sm" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export Excel
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Global search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search article, label, value, user…"
              value={draftFilters.search}
              onChange={(e) => handleDraftChange('search', e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
            />
          </div>

          {/* Row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Article Number
              </label>
              <Input
                placeholder="e.g. 12345"
                value={draftFilters.articleNumber}
                onChange={(e) => handleDraftChange('articleNumber', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Label
              </label>
              <Input
                placeholder="e.g. M_FAB_DIV"
                value={draftFilters.labelName}
                onChange={(e) => handleDraftChange('labelName', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                User Name
              </label>
              <Input
                placeholder="Name…"
                value={draftFilters.modifiedByName}
                onChange={(e) => handleDraftChange('modifiedByName', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                User Email
              </label>
              <Input
                placeholder="email@example.com"
                value={draftFilters.modifiedByEmail}
                onChange={(e) => handleDraftChange('modifiedByEmail', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                SAP Status
              </label>
              <Select
                value={draftFilters.sapStatus || '__ALL__'}
                onValueChange={(v) => handleDraftChange('sapStatus', v === '__ALL__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__ALL__">All</SelectItem>
                  <SelectItem value="SUCCESS">SUCCESS</SelectItem>
                  <SelectItem value="FAILED">FAILED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Date From
              </label>
              <Input
                type="date"
                value={draftFilters.dateFrom}
                onChange={(e) => handleDraftChange('dateFrom', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Date To
              </label>
              <Input
                type="date"
                value={draftFilters.dateTo}
                onChange={(e) => handleDraftChange('dateTo', e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleApply} className="flex-1">
                Apply Filters
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                title="Reset filters"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Active filter indicator */}
          {hasActiveFilters && (
            <p className="text-xs text-muted-foreground">
              Filters applied — showing {total.toLocaleString()} matching record
              {total !== 1 ? 's' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="py-10 text-center text-red-500 text-sm">
              Failed to load modification logs. Please try again.
            </div>
          ) : (
            <DataTable<ModifyLog>
              columns={columns}
              dataSource={logs}
              loading={isLoading}
              rowKey="id"
              size="small"
              scroll={{ x: 1100 }}
              pagination={{
                current: page,
                pageSize: PAGE_SIZE,
                total,
                onChange: (p) => setPage(p),
              }}
              locale={{ emptyText: 'No modification logs found.' }}
            />
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <DetailDialog
        groupId={selectedGroupId}
        onClose={() => setSelectedGroupId(null)}
      />
    </div>
  );
}
