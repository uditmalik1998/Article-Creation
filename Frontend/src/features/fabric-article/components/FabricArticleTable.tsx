import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Pencil } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
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
  Tag,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { cn } from '@/lib/utils';
import { getImageUrl } from '../../../shared/utils/common/helpers';
import { SIMPLIFIED_HIERARCHY } from '../../extraction/components/SimplifiedCategorySelector';
import { MAJOR_CATEGORY_ALLOWED_VALUES } from '../../../data/majorCategoryMcCodeMap';
import { getMajCatAllowedValues } from '../../../data/majCatAttributeMap';
import { preloadAttributeValues } from '../../../services/articleConfigService';
import { APP_CONFIG } from '../../../constants/app/config';
import { formatDivisionLabel } from '../../../shared/utils/ui/formatters';
import './FabricArticleTable.css';

export interface AttributeAllowedValue {
  id: number;
  shortForm: string;
  fullForm: string;
}

export interface MasterAttribute {
  id: number;
  key: string;
  label: string;
  allowedValues: AttributeAllowedValue[];
}

export interface ApproverItem {
  id: string;
  imageName: string | null;
  imageUrl: string | null;
  articleNumber: string | null;
  division: string | null;
  subDivision: string | null;
  majorCategory: string | null;
  vendorName: string | null;
  designNumber: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  sapSyncStatus: 'NOT_SYNCED' | 'PENDING' | 'SYNCED' | 'FAILED';
  sapSyncMessage: string | null;
  sapArticleId: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
  source?: string | null;
  rate: number | string | null;
  size: string | null;
  colour: string | null;
  fabricMainMvgr: string | null;
  pattern: string | null;
  fit: string | null;
  neck: string | null;
  sleeve: string | null;
  length: string | null;
  composition: string | null;
  gsm: string | null;
  wash: string | null;
  pptNumber: string | null;
  referenceArticleNumber: string | null;
  referenceArticleDescription: string | null;
  bodyArticle: string | null;
  bodyArticleDescription: string | null;
  fabricArticleNumber: string | null;
  fabricArticleDescription: string | null;
  vendorCode: string | null;
  mrp: number | string | null;
  mcCode: string | null;
  mcDescription: string | null;
  segment: string | null;
  season: string | null;
  hsnTaxCode: string | null;
  articleDescription: string | null;
  fashionGrid: string | null;
  year: string | null;
  articleType: string | null;
  yarn1: string | null;
  yarn2: string | null;
  weave: string | null;
  macroMvgr: string | null;
  mainMvgr: string | null;
  mFab2: string | null;
  finish: string | null;
  shade: string | null;
  weight: string | null;
  lycra: string | null;
  neckDetails: string | null;
  collar: string | null;
  placket: string | null;
  bottomFold: string | null;
  frontOpenStyle: string | null;
  pocketType: string | null;
  drawcord: string | null;
  button: string | null;
  zipper: string | null;
  zipColour: string | null;
  printType: string | null;
  printStyle: string | null;
  printPlacement: string | null;
  patches: string | null;
  patchesType: string | null;
  embroidery: string | null;
  embroideryType: string | null;
  fatherBelt: string | null;
  childBelt: string | null;
  fCount: string | null;
  fConstruction: string | null;
  fOunce: string | null;
  fWidth: string | null;
  fabDiv: string | null;
  fabVdr: string | null;
  sleeveFold: string | null;
  mSet: string | null;
  mNoOfSize: string | null;
  mNoOfClr: string | null;
  noOfPocket: string | null;
  extraPocket: string | null;
  dcShape: string | null;
  btnColour: string | null;
  collarStyle: string | null;
  htrfType: string | null;
  htrfStyle: string | null;
  embPlacement: string | null;
  ageGroup: string | null;
  articleFashionType: string | null;
  mvgrBrandVendor: string | null;
  impAtrbt2: string | null;
  isGeneric: boolean;
  genericArticleId: string | null;
  variantSize: string | null;
  variantColor: string | null;
  variantWeight: string | null;
  approvedBy?: number | null;
  approvedAt?: string | null;
  approver?: { name: string | null; email: string | null } | null;
}

interface EditableCellProps {
  record: ApproverItem;
  dataIndex: keyof ApproverItem;
  value: any;
  onSave: (record: ApproverItem) => void;
  inputType?: 'text' | 'select';
  options?: { label: string; value: string }[];
  display?: React.ReactNode;
}

const EditableCell: React.FC<EditableCellProps> = ({
  record,
  dataIndex,
  value,
  onSave,
  inputType = 'text',
  options = [],
  display,
}) => {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState<string>(value == null ? '' : String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setEditVal(value == null ? '' : String(value));
      inputRef.current?.focus();
      if (record.division) preloadAttributeValues(record.division).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = (next: string) => {
    setEditing(false);
    if (next === String(value ?? '')) return;
    onSave({ ...record, [dataIndex]: next || null } as ApproverItem);
  };

  if (!editing) {
    return (
      <div
        className="editable-cell-value_wrap min-h-[32px] cursor-pointer pr-6"
        onClick={() => setEditing(true)}
      >
        {display ?? (value == null || value === '' ? <span className="text-muted-foreground">—</span> : String(value))}
      </div>
    );
  }

  if (inputType === 'select') {
    return (
      <Select
        value={editVal || undefined}
        onValueChange={(v) => {
          setEditVal(v);
          commit(v);
        }}
      >
        <SelectTrigger className="h-8 w-full min-w-[100px]">
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={editVal}
      onChange={(e) => setEditVal(e.target.value)}
      onBlur={() => commit(editVal)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(editVal);
        if (e.key === 'Escape') setEditing(false);
      }}
      className="h-8"
    />
  );
};

interface ApproverTableProps {
  items: ApproverItem[];
  loading: boolean;
  selectedRowKeys: React.Key[];
  onSelectionChange: (keys: React.Key[]) => void;
  onEdit: (item: ApproverItem) => void;
  onSave: (item: ApproverItem) => void;
  attributes?: MasterAttribute[];
  user?: any;
  serverPagination?: {
    total: number;
    current: number;
    pageSize: number;
    onChange: (page: number) => void;
  };
}

const getDensity = () => {
  const ratio = window.devicePixelRatio || 1;
  if (ratio < 1) return { tableSize: 'middle' as const, imgSize: 56 };
  return { tableSize: 'small' as const, imgSize: 44 };
};

const getExtractedByLabel = (row: ApproverItem): string => {
  const source = String(row.source || '').trim().toUpperCase();
  if (source === 'WATCHER') return 'Auto';
  const userName = String(row.userName || '').trim();
  if (userName) return userName;
  return 'Auto';
};

const COL_TO_SCHEMA_KEY: Record<string, string> = {
  macroMvgr: 'macro_mvgr',
  mainMvgr: 'main_mvgr',
  yarn1: 'yarn_01',
  fabricMainMvgr: 'fabric_main_mvgr',
  weave: 'weave',
  mFab2: 'm_fab2',
  composition: 'composition',
  finish: 'finish',
  gsm: 'gsm',
  lycra: 'lycra_non_lycra',
  pattern: 'body_style',
  fit: 'fit',
  wash: 'wash',
  neck: 'neck',
  neckDetails: 'neck_details',
  collar: 'collar',
  placket: 'placket',
  sleeve: 'sleeve',
  length: 'length',
  bottomFold: 'bottom_fold',
  frontOpenStyle: 'front_open_style',
  pocketType: 'pocket_type',
  drawcord: 'drawcord',
  button: 'button',
  zipper: 'zipper',
  zipColour: 'zip_colour',
  fatherBelt: 'father_belt',
  childBelt: 'child_belt',
  printType: 'print_type',
  printStyle: 'print_style',
  printPlacement: 'print_placement',
  patches: 'patches',
  patchesType: 'patches_type',
  embroidery: 'embroidery',
  embroideryType: 'embroidery_type',
};

export const FabricArticleTable: React.FC<ApproverTableProps> = ({
  items,
  loading,
  selectedRowKeys,
  onSelectionChange,
  onEdit,
  onSave,
  user,
  serverPagination,
}) => {
  const [remarksModalOpen, setRemarksModalOpen] = useState(false);
  const [activeRemarks, setActiveRemarks] = useState('');
  const [refreshedUrls, setRefreshedUrls] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const refreshAttempted = useRef<Set<string>>(new Set());
  const [density, setDensity] = useState(getDensity);

  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => setDensity(getDensity());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState<number>(500);

  const recalcScrollY = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const available = window.innerHeight - top - 35 - 40 - 16 - 8;
    setScrollY(Math.max(200, available));
  }, []);

  useEffect(() => {
    recalcScrollY();
    window.addEventListener('resize', recalcScrollY);
    return () => window.removeEventListener('resize', recalcScrollY);
  }, [recalcScrollY]);

  const handleImageError = async (id: string) => {
    if (refreshAttempted.current.has(id)) {
      setFailedIds((prev) => new Set(prev).add(id));
      return;
    }
    refreshAttempted.current.add(id);
    setFailedIds((prev) => new Set(prev).add(id));
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/image/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.url) {
        const base = data.url as string;
        const freshUrl = base.includes('X-Amz-Signature')
          ? base
          : base + (base.includes('?') ? '&' : '?') + '_cb=' + Date.now();
        setRefreshedUrls((prev) => ({ ...prev, [id]: freshUrl }));
        setFailedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch {
      /* silent */
    }
  };

  const selectedSet = useMemo(() => new Set(selectedRowKeys.map(String)), [selectedRowKeys]);

  const toggleRow = (id: string, disabled: boolean) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(Array.from(next));
  };

  const selectableRows = items.filter((r) => r.approvalStatus !== 'REJECTED');
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedSet.has(r.id));
  const someSelected = selectableRows.some((r) => selectedSet.has(r.id));

  // Build options for an editable column
  const getOptionsFor = useCallback(
    (record: ApproverItem, field: string): { inputType: 'text' | 'select'; options: { label: string; value: string }[] } => {
      if (field === 'division') {
        return {
          inputType: 'select',
          options: [
            { label: 'MENS', value: 'MEN' },
            { label: 'LADIES', value: 'LADIES' },
            { label: 'KIDS', value: 'KIDS' },
          ],
        };
      }
      if (field === 'lycra') {
        return {
          inputType: 'select',
          options: [
            { label: '2 WAY LYCRA', value: '2W_LYC' },
            { label: '4 WAY LYCRA', value: '4W_LYC' },
            { label: 'LYCRA', value: 'LCR' },
            { label: 'NON LYCRA', value: 'N_LYC' },
          ],
        };
      }
      if (field === 'subDivision') {
        let hierKey = '';
        if (record.division?.match(/LADIES|WOMEN/i)) hierKey = 'Ladies';
        else if (record.division?.match(/KIDS/i)) hierKey = 'Kids';
        else if (record.division?.match(/MEN/i)) hierKey = 'MENS';
        return {
          inputType: 'select',
          options: (SIMPLIFIED_HIERARCHY[hierKey as keyof typeof SIMPLIFIED_HIERARCHY] || []).map((sd: string) => ({
            label: sd,
            value: sd,
          })),
        };
      }
      if (field === 'majorCategory') {
        const div = record.division || '';
        let prefixRegex: RegExp | null = null;
        if (div.match(/MEN/i)) prefixRegex = /^M|^MW/i;
        else if (div.match(/LADIES|WOMEN/i)) prefixRegex = /^L|^LW/i;
        else if (div.match(/KIDS/i)) prefixRegex = /^(K|I|J|Y|G)/i;
        return {
          inputType: 'select',
          options: MAJOR_CATEGORY_ALLOWED_VALUES.filter((v) => !prefixRegex || v.shortForm.match(prefixRegex)).map(
            (v) => ({ label: v.shortForm, value: v.shortForm }),
          ),
        };
      }
      const schemaKey = COL_TO_SCHEMA_KEY[field];
      if (schemaKey && record.majorCategory) {
        const excelValues = getMajCatAllowedValues(record.division || '', schemaKey);
        if (excelValues && excelValues.length > 0) {
          return {
            inputType: 'select',
            options: excelValues.map((v) => ({ label: v.shortForm, value: v.shortForm })),
          };
        }
      }
      return { inputType: 'text', options: [] };
    },
    [],
  );

  const renderEditable = useCallback(
    (record: ApproverItem, dataIndex: keyof ApproverItem, value: any, display?: React.ReactNode) => {
      if (record.approvalStatus === 'APPROVED' || record.approvalStatus === 'REJECTED') {
        return (
          <div
            className={cn(
              'min-h-[32px] cursor-not-allowed',
              record.approvalStatus === 'APPROVED' ? 'bg-emerald-50' : 'bg-red-50',
            )}
          >
            {display ?? (value == null ? '' : String(value))}
          </div>
        );
      }

      let canEdit = true;
      const field = String(dataIndex);
      if (user?.role === 'APPROVER' || user?.role === 'CATEGORY_HEAD') {
        if (field === 'division' && !!user.division) canEdit = false;
        if (user?.role === 'APPROVER' && field === 'subDivision' && !!user.subDivision) canEdit = false;
      }

      if (!canEdit) return display ?? (value == null ? '' : String(value));

      const { inputType, options } = getOptionsFor(record, field);
      return (
        <EditableCell
          record={record}
          dataIndex={dataIndex}
          value={value}
          onSave={onSave}
          inputType={inputType}
          options={options}
          display={display}
        />
      );
    },
    [getOptionsFor, onSave, user],
  );

  const columns = useMemo<DataTableColumn<ApproverItem>[]>(
    () => [
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
            disabled={record.approvalStatus === 'REJECTED'}
            onCheckedChange={() => toggleRow(record.id, record.approvalStatus === 'REJECTED')}
          />
        ),
      },
      {
        title: 'Image',
        key: 'image',
        width: 80,
        render: (_v, row) => {
          const src = refreshedUrls[row.id] || row.imageUrl;
          const url = src && !failedIds.has(row.id) ? getImageUrl(src) : null;
          return (
            <div
              className="overflow-hidden rounded-md bg-muted"
              style={{ width: density.imgSize, height: density.imgSize }}
            >
              {url ? (
                <img
                  src={url}
                  alt={row.imageName || 'Product'}
                  width={density.imgSize}
                  height={density.imgSize}
                  loading="lazy"
                  className="block cursor-pointer object-cover"
                  onError={() => handleImageError(row.id)}
                  onClick={() => window.open(url, '_blank')}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                  No Image
                </div>
              )}
            </div>
          );
        },
      },
      {
        title: 'Ref Details (Editable)',
        key: 'details',
        width: 200,
        render: (_v, row) => (
          <div className="flex flex-col gap-0.5">
            {row.sapArticleId ? (
              <strong className="text-xs text-emerald-700">{row.sapArticleId}</strong>
            ) : (
              <strong className="text-xs">{row.articleNumber || row.imageName || row.designNumber || 'No Article #'}</strong>
            )}
            {row.approvalStatus !== 'APPROVED' && (
              <div className="cursor-pointer text-[11px] text-sky-600" onClick={() => onEdit(row)}>
                Edit Division/Category
              </div>
            )}
            <Tag className="w-fit px-1 text-[10px] leading-[16px]">{row.vendorName || 'Unknown Vendor'}</Tag>
          </div>
        ),
      },
      {
        title: 'Division',
        dataIndex: 'division',
        key: 'division',
        width: 120,
        render: (_v, row) => renderEditable(row, 'division', row.division, formatDivisionLabel(row.division)),
      },
      {
        title: 'Sub-Division',
        dataIndex: 'subDivision',
        key: 'subDivision',
        width: 120,
        render: (_v, row) => renderEditable(row, 'subDivision', row.subDivision),
      },
      {
        title: 'Major Category',
        dataIndex: 'majorCategory',
        key: 'majorCategory',
        width: 150,
        render: (_v, row) => renderEditable(row, 'majorCategory', row.majorCategory),
      },
      {
        title: 'Design Number',
        dataIndex: 'designNumber',
        key: 'designNumber',
        width: 140,
        render: (_v, row) => renderEditable(row, 'designNumber', row.designNumber),
      },
      {
        title: 'Status',
        key: 'status',
        width: 120,
        render: (_v, row) => {
          const isDone = row.approvalStatus === 'APPROVED' && row.sapSyncStatus === 'SYNCED';
          const displayStatus =
            row.approvalStatus === 'REJECTED'
              ? 'REJECTED'
              : row.sapSyncStatus === 'FAILED'
              ? 'FAILED'
              : isDone
              ? 'DONE'
              : 'PENDING';
          const variant: 'success' | 'destructive' | 'warning' =
            displayStatus === 'DONE'
              ? 'success'
              : displayStatus === 'FAILED' || displayStatus === 'REJECTED'
              ? 'destructive'
              : 'warning';
          return <Badge variant={variant}>{displayStatus}</Badge>;
        },
      },
      {
        title: 'Remarks',
        dataIndex: 'sapSyncMessage',
        key: 'sapSyncMessage',
        width: 320,
        render: (value: unknown) => {
          const text = value == null ? '' : String(value);
          if (!text.trim()) return '-';
          const isValidationError = text.startsWith('Validation failed');
          const lines = text.split('\n').filter(Boolean);
          const headerLine = lines[0];
          const bulletLines = lines.slice(1);
          return (
            <div>
              {isValidationError ? (
                <div>
                  <div className="mb-1 text-xs font-semibold text-red-700">{headerLine}</div>
                  {bulletLines.slice(0, 2).map((line, i) => (
                    <div key={i} className="text-[11px] leading-[1.4] text-muted-foreground">
                      {line}
                    </div>
                  ))}
                  {bulletLines.length > 2 && (
                    <div className="text-[11px] text-muted-foreground">+{bulletLines.length - 2} more…</div>
                  )}
                </div>
              ) : (
                <div className="text-xs leading-[1.4] text-muted-foreground">{text}</div>
              )}
              <Button
                variant="link"
                size="sm"
                className="mt-1 h-auto p-0 text-[11px]"
                onClick={() => {
                  setActiveRemarks(text);
                  setRemarksModalOpen(true);
                }}
              >
                View Full
              </Button>
            </div>
          );
        },
      },
      ...(
        [
          ['Rate', 'rate', 100],
          ['MRP', 'mrp', 100],
        ] as const
      ).map(([title, key, width]) => ({
        title,
        dataIndex: key,
        key,
        width,
        render: (_v: any, row: ApproverItem) => renderEditable(row, key as keyof ApproverItem, row[key as keyof ApproverItem]),
      })),
      {
        title: 'Markdown',
        key: 'markdown',
        width: 110,
        render: (_v, record) => {
          const mrp = parseFloat(String(record.mrp ?? ''));
          const rate = parseFloat(String(record.rate ?? ''));
          if (!isFinite(mrp) || !isFinite(rate) || mrp === 0)
            return <span className="text-muted-foreground">—</span>;
          const md = (((mrp - rate) / mrp) * 100).toFixed(1);
          return <span className="font-semibold text-blue-600">{md}%</span>;
        },
      },
      ...(
        [
          ['Size', 'size', 120],
          ['Vendor Code', 'vendorCode', 130],
          ['MC Code', 'mcCode', 120],
          ['Segment', 'segment', 120],
          ['Season', 'season', 120],
          ['HSN Tax Code', 'hsnTaxCode', 140],
          ['Article Desc', 'articleDescription', 200],
          ['Fashion Grid', 'fashionGrid', 130],
          ['Year', 'year', 100],
          ['Article Type', 'articleType', 130],
          ['PPT #', 'pptNumber', 100],
        ] as const
      ).map(([title, key, width]) => ({
        title,
        dataIndex: key,
        key,
        width,
        render: (_v: any, row: ApproverItem) => {
          let val: any = row[key as keyof ApproverItem];
          if (key === 'mcCode' || key === 'hsnTaxCode') {
            const text = val == null ? '' : String(val).trim();
            if (!text || text.toUpperCase() === 'NA' || text.toUpperCase() === 'N/A') val = '';
          }
          return renderEditable(row, key as keyof ApproverItem, val);
        },
      })),
      {
        title: 'Extracted By',
        key: 'user',
        width: 130,
        render: (_v, row) => <span className="text-[13px]">{getExtractedByLabel(row)}</span>,
      },
      {
        title: 'Date',
        key: 'createdAt',
        width: 110,
        render: (_v, row) => (
          <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</span>
        ),
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 80,
        render: (_v, row) => (
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(row)}
            disabled={row.approvalStatus === 'APPROVED'}
          >
            <Pencil />
          </Button>
        ),
      },
    ],
    [
      allSelected,
      someSelected,
      selectableRows,
      selectedSet,
      refreshedUrls,
      failedIds,
      density.imgSize,
      onEdit,
      renderEditable,
      onSelectionChange,
    ],
  );

  return (
    <>
      <div ref={wrapperRef}>
        <DataTable<ApproverItem>
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          size={density.tableSize}
          sticky
          scroll={{ x: 'max-content', y: scrollY }}
          rowClassName="editable-row"
          className={density.tableSize === 'small' ? 'approver-compact-table' : 'approver-comfortable-table'}
          pagination={
            serverPagination
              ? {
                  total: serverPagination.total,
                  current: serverPagination.current,
                  pageSize: serverPagination.pageSize,
                  onChange: (p) => serverPagination.onChange(p),
                  showSizeChanger: false,
                }
              : { pageSize: 50, showSizeChanger: false }
          }
        />
      </div>

      <Dialog open={remarksModalOpen} onOpenChange={setRemarksModalOpen}>
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>SAP Sync Remarks</DialogTitle>
          </DialogHeader>
          {(() => {
            const text = activeRemarks || '';
            if (!text) return <span className="text-muted-foreground">—</span>;
            if (!text.startsWith('Validation failed')) {
              return <div className="whitespace-pre-wrap break-words text-[13px]">{text}</div>;
            }
            const lines = text.split('\n').filter(Boolean);
            const [header, ...bullets] = lines;
            return (
              <div>
                <div className="mb-4 flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2">
                  <span className="text-base text-red-700">✕</span>
                  <span className="text-[13px] font-semibold text-red-700">{header}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {bullets.map((line, i) => {
                    const clean = line.replace(/^•\s*/, '');
                    const colonIdx = clean.indexOf(':');
                    const field = colonIdx > -1 ? clean.slice(0, colonIdx) : clean;
                    const rest = colonIdx > -1 ? clean.slice(colonIdx + 1) : '';
                    return (
                      <div
                        key={i}
                        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-[1.5]"
                      >
                        <span className="font-semibold text-amber-700">{field}</span>
                        <span className="text-muted-foreground">:{rest}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
};
