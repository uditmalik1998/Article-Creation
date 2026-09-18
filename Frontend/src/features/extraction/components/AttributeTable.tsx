import React, { useMemo, useState } from 'react';
import { RotateCw, Eye, MoreHorizontal, Zap, AlertTriangle } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tag,
  Tooltip,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import type { ExtractedRow, SchemaItem } from '../../../shared/types/extraction/ExtractionTypes';
import { StatusBadge } from '../../../shared/components/ui/StatusBadge';
import { AttributeCell } from './AttributeCell';
import { formatDuration, formatFileSize } from '../../../shared/utils/common/helpers';

interface AttributeTableProps {
  extractedRows: ExtractedRow[];
  schema: SchemaItem[];
  selectedRowKeys: React.Key[];
  onSelectionChange: (selectedRowKeys: React.Key[]) => void;
  onAttributeChange: (rowId: string, attributeKey: string, value: string | number | null) => void;
  onDeleteRow: (rowId: string) => void;
  onImageClick: (imageUrl: string, imageName?: string) => void;
  onReExtract: (rowId: string, forceRefresh?: boolean) => void;
  onAddToSchema?: (attributeKey: string, value: string) => void;
  isExtracting?: boolean;
  disableEditing?: boolean;
}

export const AttributeTable: React.FC<AttributeTableProps> = ({
  extractedRows,
  schema,
  selectedRowKeys,
  onSelectionChange,
  onAttributeChange,
  onDeleteRow,
  onImageClick,
  onReExtract,
  onAddToSchema,
  disableEditing = false,
}) => {
  const [focusedCellKey, setFocusedCellKey] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedRowKeys.map(String)), [selectedRowKeys]);

  const toggleRow = (id: string, disabled: boolean) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(Array.from(next));
  };

  const selectableRows = extractedRows.filter((r) => r.status !== 'Extracting');
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedSet.has(r.id));
  const someSelected = selectableRows.some((r) => selectedSet.has(r.id));

  const columns = useMemo<DataTableColumn<ExtractedRow>[]>(() => {
    const baseColumns: DataTableColumn<ExtractedRow>[] = [
      {
        title: (
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={() => {
              if (allSelected) onSelectionChange([]);
              else onSelectionChange(selectableRows.map((r) => r.id));
            }}
          />
        ),
        key: '__select__',
        width: 44,
        render: (_v, record) => (
          <Checkbox
            checked={selectedSet.has(record.id)}
            disabled={record.status === 'Extracting'}
            onCheckedChange={() => toggleRow(record.id, record.status === 'Extracting')}
          />
        ),
      },
      {
        title: 'Picture No.',
        key: 'pictureNumber',
        width: 130,
        render: (_v, record) => (
          <div className="break-all text-[11px] text-muted-foreground">{record.originalFileName}</div>
        ),
      },
      {
        title: 'Image',
        key: 'image',
        width: 80,
        align: 'center',
        render: (_v, record) => (
          <div className="text-center">
            <img
              src={record.imagePreviewUrl || '/placeholder.svg'}
              alt={record.originalFileName}
              width={50}
              height={50}
              className="cursor-pointer rounded object-cover"
              onClick={() => onImageClick(record.imagePreviewUrl, record.originalFileName)}
            />
            <div className="mt-0.5 text-[9px] text-muted-foreground">{formatFileSize(record.file.size)}</div>
          </div>
        ),
      },
      {
        title: 'Status',
        key: 'status',
        width: 100,
        render: (_v, record) => (
          <div>
            <StatusBadge status={record.status} />
            {record.extractionTime && (
              <div className="mt-0.5 text-[9px] text-muted-foreground">{formatDuration(record.extractionTime)}</div>
            )}
            {record.error && (
              <Tooltip title={record.error}>
                <div className="mt-0.5 flex cursor-help items-center gap-0.5 text-[9px] text-red-500">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Error
                </div>
              </Tooltip>
            )}
          </div>
        ),
      },
    ];

    const attributeColumns: DataTableColumn<ExtractedRow>[] = schema.map((schemaItem, schemaIndex) => ({
      title: (
        <div>
          <div className="text-xs">{schemaItem.label}</div>
          {schemaItem.required && <Tag className="mt-0.5 bg-red-50 px-1 text-[10px] text-red-700">Required</Tag>}
        </div>
      ),
      key: schemaItem.key,
      width: 150,
      render: (_v, record) => {
        const cellKey = `${record.id}::${schemaItem.key}`;
        let nextCellKey: string | null = null;
        if (extractedRows.length === 1) {
          const nextSchemaItem = schema[schemaIndex + 1];
          nextCellKey = nextSchemaItem ? `${record.id}::${nextSchemaItem.key}` : null;
        } else {
          const currentRowIndex = extractedRows.findIndex((r) => r.id === record.id);
          const nextRow = extractedRows[currentRowIndex + 1];
          nextCellKey = nextRow ? `${nextRow.id}::${schemaItem.key}` : null;
        }
        const cellVal = record.attributes[schemaItem.key];
        const isEmpty = !String(cellVal?.schemaValue ?? cellVal?.rawValue ?? '').trim();
        const showRequired = schemaItem.required && isEmpty && record.status !== 'Extracting';
        return (
          <div className={cn(showRequired && 'rounded border border-red-400 bg-red-50/40')}>
            <AttributeCell
              attribute={cellVal}
              schemaItem={schemaItem}
              onChange={(value) => onAttributeChange(record.id, schemaItem.key, value)}
              onAddToSchema={(value) => onAddToSchema?.(schemaItem.key, value)}
              disabled={record.status === 'Extracting' || disableEditing}
              autoFocus={focusedCellKey === cellKey}
              onAutoFocused={() => setFocusedCellKey(null)}
              onSaveAndNext={nextCellKey ? () => setFocusedCellKey(nextCellKey) : undefined}
            />
          </div>
        );
      },
    }));

    // Markdown column injected after mrp column (if both rate and mrp present)
    const hasMrp = schema.some((s) => s.key === 'mrp');
    const hasRate = schema.some((s) => s.key === 'rate');
    if (hasMrp && hasRate) {
      const markdownColumn: DataTableColumn<ExtractedRow> = {
        title: <div className="text-xs">Markdown</div>,
        key: '__markdown__',
        width: 110,
        render: (_v, record) => {
          const mrpAttr = record.attributes?.['mrp'];
          const rateAttr = record.attributes?.['rate'];
          const mrp = parseFloat(String(mrpAttr?.schemaValue ?? mrpAttr?.rawValue ?? ''));
          const rate = parseFloat(String(rateAttr?.schemaValue ?? rateAttr?.rawValue ?? ''));
          if (!isFinite(mrp) || !isFinite(rate) || mrp === 0)
            return <span className="text-muted-foreground">—</span>;
          const md = (((mrp - rate) / mrp) * 100).toFixed(1);
          return <span className="font-semibold text-blue-600">{md}%</span>;
        },
      };
      const mrpIdx = attributeColumns.findIndex((c) => c.key === 'mrp');
      if (mrpIdx >= 0) attributeColumns.splice(mrpIdx + 1, 0, markdownColumn);
    }

    const actionsColumn: DataTableColumn<ExtractedRow>[] = [
      {
        title: 'Actions',
        key: 'actions',
        width: 100,
        render: (_v, record) => (
          <div className="flex items-center gap-0.5">
            <Tooltip title="View Image">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onImageClick(record.imagePreviewUrl, record.originalFileName)}
              >
                <Eye />
              </Button>
            </Tooltip>
            <Tooltip title="Re-extract">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onReExtract(record.id, false)}
                disabled={record.status === 'Extracting'}
              >
                <RotateCw />
              </Button>
            </Tooltip>
            <Tooltip title="Force fresh">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-amber-500"
                onClick={() => onReExtract(record.id, true)}
                disabled={record.status === 'Extracting'}
              >
                <Zap />
              </Button>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-destructive" onClick={() => onDeleteRow(record.id)}>
                  Delete Row
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];

    return [...baseColumns, ...attributeColumns, ...actionsColumn];
  }, [
    schema,
    extractedRows,
    onAttributeChange,
    onAddToSchema,
    onDeleteRow,
    onImageClick,
    onReExtract,
    focusedCellKey,
    selectedSet,
    allSelected,
    someSelected,
    selectableRows,
    onSelectionChange,
    disableEditing,
  ]);

  const stats = {
    total: extractedRows.length,
    done: extractedRows.filter((r) => r.status === 'Done').length,
    error: extractedRows.filter((r) => r.status === 'Error').length,
    pending: extractedRows.filter((r) => r.status === 'Pending').length,
  };

  return (
    <div className="flex flex-col">
      <DataTable<ExtractedRow>
        columns={columns}
        dataSource={extractedRows}
        rowKey="id"
        size="small"
        scroll={{ x: 'max-content', y: 'calc(100vh - 320px)' }}
        pagination={{
          pageSize: 100,
          showSizeChanger: true,
          pageSizeOptions: ['50', '100', '200', '500'],
        }}
        rowClassName={(record) =>
          cn(
            record.status === 'Error' && 'table-row-error',
            record.status === 'Done' && 'table-row-success',
            record.status === 'Extracting' && 'table-row-processing',
          )
        }
      />
      <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
        <strong className="text-sm">Summary:</strong>
        <Badge variant="success">Done: {stats.done}</Badge>
        <Badge variant="destructive">Error: {stats.error}</Badge>
        <Badge variant="info">Pending: {stats.pending}</Badge>
        <Badge variant="secondary">Total: {stats.total}</Badge>
      </div>
    </div>
  );
};
