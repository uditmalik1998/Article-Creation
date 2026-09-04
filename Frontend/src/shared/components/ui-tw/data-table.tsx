/**
 * Antd-`Table`-compatible wrapper around our shadcn-style table primitives.
 *
 * Accepts the same shape of `columns` and `dataSource` so we can migrate
 * antd `<Table>` usages with minimal diffs. Pagination is in-memory and
 * mirrors the subset of antd pagination we actually use.
 *
 * For complex sorting/filtering, prefer TanStack Table directly.
 */
import * as React from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Empty } from './empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

export interface DataTableColumn<T = any> {
  title?: React.ReactNode;
  dataIndex?: keyof T | string;
  key?: string;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  fixed?: 'left' | 'right';
  className?: string;
  render?: (value: any, record: T, index: number) => React.ReactNode;
}

export interface DataTablePagination {
  current?: number;
  pageSize?: number;
  total?: number;
  showSizeChanger?: boolean;
  pageSizeOptions?: string[];
  position?: ('topRight' | 'bottomRight' | 'bottomLeft')[];
  onChange?: (page: number, pageSize: number) => void;
}

export interface DataTableProps<T = any> {
  columns: DataTableColumn<T>[];
  dataSource?: T[];
  loading?: boolean;
  rowKey?: string | ((record: T, index: number) => string);
  pagination?: DataTablePagination | false;
  size?: 'small' | 'middle' | 'large';
  scroll?: { x?: number | string; y?: number | string };
  className?: string;
  locale?: { emptyText?: React.ReactNode };
  rowClassName?: string | ((record: T, index: number) => string);
  sticky?: boolean;
  onRow?: (record: T, index: number) => React.HTMLAttributes<HTMLTableRowElement>;
  /** Excel-style drag-to-resize column dividers. Off by default so existing
   * tables keep their natural/content-based column sizing unchanged. */
  resizableColumns?: boolean;
}

const MIN_COLUMN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 150;

function getColumnKey(col: DataTableColumn<any>, index: number): string {
  return col.key ?? String(col.dataIndex ?? index);
}

const getRowKey = <T,>(record: T, index: number, rowKey?: DataTableProps<T>['rowKey']): string => {
  if (typeof rowKey === 'function') return rowKey(record, index);
  if (typeof rowKey === 'string' && record && typeof record === 'object') {
    return String((record as any)[rowKey] ?? index);
  }
  if (record && typeof record === 'object' && 'key' in (record as any)) {
    return String((record as any).key);
  }
  return String(index);
};

const getCellValue = <T,>(record: T, dataIndex?: keyof T | string): any => {
  if (!dataIndex) return undefined;
  if (typeof dataIndex === 'string' && dataIndex.includes('.')) {
    return dataIndex.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), record);
  }
  return (record as any)[dataIndex];
};

const sizePadding = {
  small: 'px-2 py-1.5',
  middle: 'px-3 py-2',
  large: 'px-4 py-3',
};

/** Columns pinned via `fixed` stay in view during horizontal scroll — needed when
 * a table has enough columns that an action button would otherwise scroll off-screen. */
function getFixedClasses(col: DataTableColumn<any>): string | undefined {
  if (col.fixed === 'right') return 'sticky right-0 z-20 bg-background border-l border-border';
  if (col.fixed === 'left') return 'sticky left-0 z-20 bg-background border-r border-border';
  return undefined;
}

export function DataTable<T = any>({
  columns,
  dataSource = [],
  loading,
  rowKey,
  pagination,
  size = 'middle',
  scroll,
  className,
  locale,
  rowClassName,
  sticky,
  onRow,
  resizableColumns,
}: DataTableProps<T>) {
  // Excel-style column resize: widths start from each column's declared `width`
  // (or a default) and are overridden per-column once the user drags a divider.
  const [columnWidths, setColumnWidths] = React.useState<Record<string, number>>({});
  const resizeState = React.useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const getColumnWidth = React.useCallback(
    (col: DataTableColumn<any>, index: number): number | undefined => {
      if (!resizableColumns) return typeof col.width === 'number' ? col.width : undefined;
      const key = getColumnKey(col, index);
      return columnWidths[key] ?? (typeof col.width === 'number' ? col.width : DEFAULT_COLUMN_WIDTH);
    },
    [resizableColumns, columnWidths],
  );

  const onResizeMove = React.useCallback((e: MouseEvent) => {
    const r = resizeState.current;
    if (!r) return;
    const next = Math.max(MIN_COLUMN_WIDTH, r.startWidth + (e.clientX - r.startX));
    setColumnWidths((prev) => (prev[r.key] === next ? prev : { ...prev, [r.key]: next }));
  }, []);

  const stopResizing = React.useCallback(() => {
    resizeState.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', stopResizing);
  }, [onResizeMove]);

  const startResizing = React.useCallback(
    (key: string, startWidth: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeState.current = { key, startX: e.clientX, startWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onResizeMove);
      window.addEventListener('mouseup', stopResizing);
    },
    [onResizeMove, stopResizing],
  );

  // Detach any in-flight drag listeners if the table unmounts mid-drag.
  React.useEffect(() => () => stopResizing(), [stopResizing]);
  // Server-paginated mode: the caller passes `total` (the full row count from the
  // backend) and `dataSource` is already just the current page — don't re-slice it,
  // and compute page count from `total`, not from the length of that one page.
  const isServerPaged = pagination !== false && typeof pagination?.total === 'number';

  const [internalPage, setInternalPage] = React.useState(pagination && typeof pagination === 'object' ? pagination.current ?? 1 : 1);
  const [internalPageSize, setInternalPageSize] = React.useState(
    pagination && typeof pagination === 'object' ? pagination.pageSize ?? 10 : 10,
  );

  // Controlled `current`/`pageSize` can change from outside a Prev/Next click here
  // (e.g. the parent resets to page 1 after a new search) — stay in sync with them.
  const controlledCurrent = pagination && typeof pagination === 'object' ? pagination.current : undefined;
  const controlledPageSize = pagination && typeof pagination === 'object' ? pagination.pageSize : undefined;
  React.useEffect(() => {
    if (controlledCurrent !== undefined) setInternalPage(controlledCurrent);
  }, [controlledCurrent]);
  React.useEffect(() => {
    if (controlledPageSize !== undefined) setInternalPageSize(controlledPageSize);
  }, [controlledPageSize]);

  const paged = React.useMemo(() => {
    if (pagination === false || isServerPaged) return dataSource;
    const start = (internalPage - 1) * internalPageSize;
    return dataSource.slice(start, start + internalPageSize);
  }, [dataSource, pagination, isServerPaged, internalPage, internalPageSize]);

  const totalPages =
    pagination === false
      ? 1
      : Math.max(1, Math.ceil((isServerPaged ? pagination.total! : dataSource.length) / internalPageSize));
  const hasPager = pagination !== false;
  const hasRows = isServerPaged ? (pagination as DataTablePagination).total! > 0 : dataSource.length > 0;

  // scroll.y === '100%' means "fill whatever space the parent flex layout gives this
  // table" (leaving room for the pagination bar below) rather than a fixed cap — a
  // percentage maxHeight can't do that once there's a sibling to share space with, so
  // it's handled via flex-grow instead.
  const fillsAvailableHeight = scroll?.y === '100%';

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        className={cn(
          'rounded-md border border-border',
          scroll?.y && 'overflow-auto',
          fillsAvailableHeight && 'flex-1 min-h-0',
        )}
        style={{
          maxHeight: fillsAvailableHeight ? undefined : typeof scroll?.y === 'number' ? scroll.y : scroll?.y,
        }}
      >
        {/* `Table` defaults to `w-full`, which under table-layout:fixed would proportionally
            rescale every column to always fit the container — the opposite of Excel-style
            resize, where widening a column grows the sheet and reveals horizontal scroll.
            `w-auto` cancels that so the table's width is the sum of its column widths;
            `min-w-full` keeps it filling the container when that sum is narrower. */}
        <Table
          className={resizableColumns ? 'w-auto min-w-full' : undefined}
          style={resizableColumns ? { tableLayout: 'fixed' } : undefined}
        >
          <TableHeader className={sticky ? 'sticky top-0 z-10 bg-background' : undefined}>
            <TableRow>
              {columns.map((col, ci) => {
                const width = getColumnWidth(col, ci);
                const key = getColumnKey(col, ci);
                return (
                  <TableHead
                    key={key}
                    style={{ width, minWidth: width, maxWidth: width, textAlign: col.align }}
                    className={cn(
                      sizePadding[size],
                      'relative border-r border-border last:border-r-0',
                      getFixedClasses(col),
                      col.className,
                    )}
                  >
                    {resizableColumns ? <span className="block truncate">{col.title}</span> : col.title}
                    {resizableColumns && (
                      <span
                        onMouseDown={startResizing(key, width ?? DEFAULT_COLUMN_WIDTH)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize select-none touch-none"
                        title="Drag to resize"
                      />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                </TableCell>
              </TableRow>
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8">
                  <Empty description={locale?.emptyText ?? 'No data'} />
                </TableCell>
              </TableRow>
            ) : (
              paged.map((record, ri) => {
                const key = getRowKey(record, ri, rowKey);
                const rowExtra = onRow?.(record, ri);
                const rowCls = typeof rowClassName === 'function' ? rowClassName(record, ri) : rowClassName;
                return (
                  <TableRow key={key} {...rowExtra} className={cn('group', rowExtra?.className, rowCls)}>
                    {columns.map((col, ci) => {
                      const value = getCellValue(record, col.dataIndex);
                      const content = col.render ? col.render(value, record, ri) : value;
                      const width = getColumnWidth(col, ci);
                      return (
                        <TableCell
                          key={getColumnKey(col, ci)}
                          style={{ width, minWidth: width, maxWidth: width, textAlign: col.align }}
                          className={cn(
                            sizePadding[size],
                            'border-r border-border last:border-r-0',
                            resizableColumns && 'overflow-hidden',
                            getFixedClasses(col),
                            col.fixed && 'group-hover:bg-muted/40',
                            col.className,
                          )}
                        >
                          {content as React.ReactNode}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {hasPager && hasRows && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {pagination && pagination.showSizeChanger !== false && (
            <Select
              value={String(internalPageSize)}
              onValueChange={(v) => {
                const n = Number(v);
                setInternalPageSize(n);
                setInternalPage(1);
                pagination && pagination.onChange?.(1, n);
              }}
            >
              <SelectTrigger className="h-8 w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(pagination && pagination.pageSizeOptions ? pagination.pageSizeOptions : ['10', '25', '50', '100']).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-sm text-muted-foreground">
            Page {internalPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={internalPage <= 1}
            onClick={() => {
              const next = Math.max(1, internalPage - 1);
              setInternalPage(next);
              pagination && pagination.onChange?.(next, internalPageSize);
            }}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={internalPage >= totalPages}
            onClick={() => {
              const next = Math.min(totalPages, internalPage + 1);
              setInternalPage(next);
              pagination && pagination.onChange?.(next, internalPageSize);
            }}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
