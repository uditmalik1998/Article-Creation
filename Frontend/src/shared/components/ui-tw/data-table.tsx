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
}: DataTableProps<T>) {
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

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        className={cn('rounded-md border border-border', scroll?.y && 'overflow-auto')}
        style={{
          maxHeight: typeof scroll?.y === 'number' ? scroll.y : scroll?.y,
        }}
      >
        <Table>
          <TableHeader className={sticky ? 'sticky top-0 z-10' : undefined}>
            <TableRow>
              {columns.map((col, ci) => (
                <TableHead
                  key={col.key ?? String(col.dataIndex ?? ci)}
                  style={{ width: col.width, textAlign: col.align }}
                  className={cn(sizePadding[size], col.className)}
                >
                  {col.title}
                </TableHead>
              ))}
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
                  <TableRow key={key} {...rowExtra} className={cn(rowExtra?.className, rowCls)}>
                    {columns.map((col, ci) => {
                      const value = getCellValue(record, col.dataIndex);
                      const content = col.render ? col.render(value, record, ri) : value;
                      return (
                        <TableCell
                          key={col.key ?? String(col.dataIndex ?? ci)}
                          style={{ width: col.width, textAlign: col.align }}
                          className={cn(sizePadding[size], col.className)}
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
