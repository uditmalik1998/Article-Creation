import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Download, RotateCw, Search } from 'lucide-react';
import { Button, Card, CardContent, DataTable, Input, type DataTableColumn } from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { downloadFgFabricMapping, getFgFabricMapping, type FgFabricMappingRow } from '../../../services/adminApi';

const PAGE_SIZE = 50;

/**
 * FG -> Fabric mapping: every approved FG article number and the fabric
 * article number it uses. Search an FG number to see its fabric, or a fabric
 * number to see every FG on it.
 */
export default function FgFabricMappingPage() {
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  // Refresh bumps `nonce` and asks the server to reload its cache once.
  const [nonce, setNonce] = useState(0);
  const forceFresh = useRef(false);

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['fg-fabric-mapping', search, page, nonce],
    queryFn: () => {
      const fresh = forceFresh.current;
      forceFresh.current = false;
      return getFgFabricMapping(search, page, PAGE_SIZE, fresh);
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

  const applySearch = (value = draftSearch) => {
    setPage(1);
    setSearch(value.trim());
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await downloadFgFabricMapping(search);
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
    { title: 'FG Art No', key: 'fgArtNo', render: (_v, r) => <span className="font-mono">{r.fgArtNo}</span> },
    {
      title: 'Fabric Art No',
      key: 'fabArtNo',
      render: (_v, r) =>
        r.fabArtNo ? (
          <button
            type="button"
            className="font-mono text-primary hover:underline"
            title="Show every FG on this fabric"
            onClick={() => {
              setDraftSearch(r.fabArtNo!);
              applySearch(r.fabArtNo!);
            }}
          >
            {r.fabArtNo}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
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
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {isAdmin ? 'Back to Expenses' : 'Back to Expense Data'}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">FG to Fabric Mapping</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data
              ? `${data.total.toLocaleString('en-IN')} FG articles · ${data.withFabric.toLocaleString('en-IN')} with a fabric`
              : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => {
              forceFresh.current = true;
              setNonce((n) => n + 1);
            }}
          >
            <RotateCw className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button size="sm" disabled={downloading || !data?.total} onClick={handleDownload}>
            <Download />
            {downloading ? 'Preparing…' : 'Download Excel'}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="FG or fabric article number…"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySearch();
            }}
          />
        </div>
        <Button onClick={() => applySearch()}>Search</Button>
        {search && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraftSearch('');
              applySearch('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

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
              pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: (p) => setPage(p) }}
              locale={{ emptyText: 'No FG articles match this search.' }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
