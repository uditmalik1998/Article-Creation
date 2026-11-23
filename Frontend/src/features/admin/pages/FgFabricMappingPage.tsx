import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Download, RotateCw, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import {
  downloadFgFabricMapping,
  getFgFabricMapping,
  type FgFabricMappingFilters,
  type FgFabricMappingRow,
} from '../../../services/adminApi';

const PAGE_SIZE = 50;
const ALL = '__ALL__';

const nf = new Intl.NumberFormat('en-IN');

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}

function StatCard({ label, value, hint }: { label: string; value: number | undefined; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value == null ? '…' : nf.format(value)}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  width = 'w-44',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  width?: string;
}) {
  return (
    <div className={width}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const asOptions = (values: string[] | undefined) => (values ?? []).map((v) => ({ value: v, label: v }));

/**
 * FG -> Fabric mapping: every approved FG article and the fabric article it
 * uses (and, by searching a fabric number, every FG on that fabric). Starts
 * from the FG side, so FG articles without a fabric are listed too.
 */
export default function FgFabricMappingPage() {
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [fgDiv, setFgDiv] = useState(ALL);
  const [fgMajCat, setFgMajCat] = useState(ALL);
  const [mapped, setMapped] = useState(ALL);
  const [fabDiv, setFabDiv] = useState(ALL);
  const [fabVendor, setFabVendor] = useState(ALL);
  const [month, setMonth] = useState(ALL);
  const [page, setPage] = useState(1);
  // Refresh bumps `nonce` and asks the server to reload its cache once; later
  // pages and filters read the (now fresh) cache as usual.
  const [nonce, setNonce] = useState(0);
  const forceFresh = useRef(false);
  const [downloading, setDownloading] = useState(false);

  const pick = (v: string) => (v === ALL ? undefined : v);
  const filters: FgFabricMappingFilters = {
    search: search || undefined,
    fgDiv: pick(fgDiv),
    fgMajCat: pick(fgMajCat),
    fabricMapped: pick(mapped) as 'YES' | 'NO' | undefined,
    fabDiv: pick(fabDiv),
    fabVendor: pick(fabVendor),
    month: pick(month),
  };

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['fg-fabric-mapping', filters, page, nonce],
    queryFn: () => {
      const fresh = forceFresh.current;
      forceFresh.current = false;
      return getFgFabricMapping(filters, page, PAGE_SIZE, fresh);
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const isAdmin = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') ?? '{}')?.role === 'ADMIN';
    } catch {
      return false;
    }
  })();
  const backTo = isAdmin ? '/admin/expenses' : '/admin/expense-masters';

  const noAccess = (error as { response?: { status?: number } } | null)?.response?.status === 403;
  const opts = data?.options;
  const set = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const applySearch = () => {
    setPage(1);
    setSearch(draftSearch.trim());
  };

  const clearAll = () => {
    setDraftSearch('');
    setSearch('');
    setFgDiv(ALL);
    setFgMajCat(ALL);
    setMapped(ALL);
    setFabDiv(ALL);
    setFabVendor(ALL);
    setMonth(ALL);
    setPage(1);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await downloadFgFabricMapping(filters);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `FG_FABRIC_MAPPING_${dayjs().format('YYYY-MM-DD')}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: any) {
      message.error(err?.message || 'Could not download the Excel file.');
    } finally {
      setDownloading(false);
    }
  };

  const columns: DataTableColumn<FgFabricMappingRow>[] = [
    { title: 'FG Art No', key: 'fgArtNo', width: 120, render: (_v, r) => <span className="font-mono text-xs">{r.fgArtNo}</span> },
    {
      title: 'FG Art Desc',
      key: 'fgArtDesc',
      width: 260,
      render: (_v, r) => (r.fgArtDesc ? <span className="line-clamp-2 text-xs">{r.fgArtDesc}</span> : <Muted />),
    },
    { title: 'FG Div', key: 'fgDiv', width: 80, render: (_v, r) => r.fgDiv ?? <Muted /> },
    { title: 'FG Maj Cat', key: 'fgMajCat', width: 120, render: (_v, r) => r.fgMajCat ?? <Muted /> },
    {
      title: 'FG Created',
      key: 'fgCreatedDate',
      width: 105,
      render: (_v, r) =>
        r.fgCreatedDate ? <span className="whitespace-nowrap text-xs">{dayjs(r.fgCreatedDate).format('DD-MMM-YYYY')}</span> : <Muted />,
    },
    {
      title: 'Fabric Mapped',
      key: 'fabricMapped',
      width: 105,
      render: (_v, r) =>
        r.fabricMapped === 'YES' ? (
          <Badge className="border-green-200 bg-green-100 text-green-700">YES</Badge>
        ) : (
          <Badge className="border-amber-200 bg-amber-100 text-amber-700">NO</Badge>
        ),
    },
    {
      title: 'Fabric Art No',
      key: 'fabArtNo',
      width: 140,
      render: (_v, r) =>
        r.fabArtNo ? (
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              className="text-left font-mono text-xs text-primary hover:underline"
              title="Show every FG on this fabric"
              onClick={() => {
                setDraftSearch(r.fabArtNo!);
                setSearch(r.fabArtNo!);
                setPage(1);
              }}
            >
              {r.fabArtNo}
            </button>
            {!r.fabricInApp && <span className="text-[10px] text-amber-700">fabric not in app</span>}
          </div>
        ) : (
          <Muted />
        ),
    },
    {
      title: 'Fabric Art Desc',
      key: 'fabArtDesc',
      width: 240,
      render: (_v, r) => (r.fabArtDesc ? <span className="line-clamp-2 text-xs">{r.fabArtDesc}</span> : <Muted />),
    },
    { title: 'Fabric Div', key: 'fabDiv', width: 100, render: (_v, r) => r.fabDiv ?? <Muted /> },
    { title: 'UOM', key: 'fabUom', width: 60, render: (_v, r) => r.fabUom ?? <Muted /> },
    {
      title: 'Fabric Vendor',
      key: 'fabVendor',
      width: 200,
      render: (_v, r) => (r.fabVendor ? <span className="line-clamp-1 text-xs">{r.fabVendor}</span> : <Muted />),
    },
    {
      title: 'Fabric Rate',
      key: 'fabRate',
      width: 95,
      align: 'right',
      render: (_v, r) => (r.fabRate != null ? <span className="tabular-nums">Rs {r.fabRate}</span> : <Muted />),
    },
  ];

  if (noAccess) {
    return (
      <div className="space-y-4 p-6">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You don't have access to this page. Ask an admin for Expense Data access.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {isAdmin ? 'Back to Expenses' : 'Back to Expense Data'}
        </Link>
        <div className="flex items-center gap-2">
          {data?.loadedAt && (
            <span className="text-xs text-muted-foreground">Data as of {dayjs(data.loadedAt).format('DD-MMM HH:mm')}</span>
          )}
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => {
              forceFresh.current = true;
              setNonce((n) => n + 1);
            }}>
            <RotateCw className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button size="sm" disabled={downloading || !data?.total} onClick={handleDownload}>
            <Download />
            {downloading ? 'Preparing…' : 'Download Excel'}
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold">FG to Fabric Mapping</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          Every approved FG article and the fabric article it uses. Search an FG to see its fabric, or a fabric number to
          see every FG made from it. FG articles without a fabric are listed too.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="FG articles" value={data?.stats.fgArticles} />
        <StatCard label="FG with fabric" value={data?.stats.withFabric} />
        <StatCard label="FG without fabric" value={data?.stats.withoutFabric} />
        <StatCard label="Different fabrics" value={data?.stats.distinctFabrics} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="FG no / desc, fabric no / desc, fabric vendor…"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
              }}
            />
          </div>
          <FilterSelect value={fgDiv} onChange={set(setFgDiv)} placeholder="All FG divisions" options={asOptions(opts?.fgDivs)} />
          <FilterSelect
            value={fgMajCat}
            onChange={set(setFgMajCat)}
            placeholder="All major categories"
            options={asOptions(opts?.fgMajCats)}
            width="w-52"
          />
          <FilterSelect
            value={mapped}
            onChange={set(setMapped)}
            placeholder="Fabric mapped: all"
            options={[
              { value: 'YES', label: 'Fabric mapped: YES' },
              { value: 'NO', label: 'Fabric mapped: NO' },
            ]}
          />
          <FilterSelect value={fabDiv} onChange={set(setFabDiv)} placeholder="All fabric divisions" options={asOptions(opts?.fabDivs)} />
          <FilterSelect
            value={fabVendor}
            onChange={set(setFabVendor)}
            placeholder="All fabric vendors"
            options={asOptions(opts?.fabVendors)}
            width="w-56"
          />
          <FilterSelect
            value={month}
            onChange={set(setMonth)}
            placeholder="All created months"
            options={(opts?.months ?? []).map((m) => ({ value: m, label: dayjs(`${m}-01`).format('MMM YYYY') }))}
          />
          <Button onClick={applySearch}>Search</Button>
          <Button variant="ghost" onClick={clearAll}>
            Clear
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="py-10 text-center text-sm text-red-500">Failed to load the FG to fabric mapping.</div>
          ) : (
            <DataTable
              columns={columns}
              dataSource={data?.rows ?? []}
              loading={isLoading}
              rowKey="fgArtNo"
              size="small"
              scroll={{ x: 1600 }}
              pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: (p) => setPage(p) }}
              locale={{ emptyText: 'No FG articles match these filters.' }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
