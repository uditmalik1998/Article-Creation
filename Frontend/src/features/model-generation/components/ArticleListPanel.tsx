import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Label,
  Input,
  Textarea,
} from '@/shared/components/ui-tw';

export interface ArticleListSubmit {
  file: File | null;
  codesText: string;
}

interface Props {
  submitting: boolean;
  onSubmit: (payload: ArticleListSubmit) => void;
}

// Client-side preview parse (backend re-parses authoritatively).
function parseArticleCodes(raw: string[]): string[] {
  return Array.from(new Set(
    raw.map(s => s.trim())
      .filter(v => v && v.toLowerCase() !== 'final art')
      .map(v => v.toLowerCase())
  ));
}

export function ArticleListPanel({ submitting, onSubmit }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [codesText, setCodesText] = useState('');
  const [generate, setGenerate] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const pastedCount = useMemo(() => parseArticleCodes(codesText.split(/[\r\n,]+/)).length, [codesText]);
  const articleCount = file ? (fileCount ?? 0) : pastedCount;
  const imageCount = articleCount * 5;

  async function handleFile(f: File | null) {
    setFile(f);
    setFileCount(null);
    setFileError(null);
    setCodesText('');            // selecting a file supersedes pasted text — clear it to avoid ambiguity
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
      setFileCount(parseArticleCodes(matrix.map(r => String(r?.[0] ?? ''))).length);
    } catch {
      setFile(null);
      setFileError('Could not read file — is it a valid .xlsx or .csv?');
    }
  }

  const canSubmit = generate && !submitting && articleCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Article list (.xlsx / .csv)</Label>
        <Input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {file && fileCount !== null && (
          <p className="text-xs text-muted-foreground mt-1">{fileCount} unique article codes detected</p>
        )}
        {fileError && <p className="text-xs text-destructive mt-1">{fileError}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>…or paste codes (one FINAL ART per line)</Label>
        <Textarea
          rows={5}
          className="resize-y"
          placeholder={'1110097922-BLACK\n1110106859-DARK GREY'}
          value={codesText}
          onChange={(e) => setCodesText(e.target.value)}
          disabled={!!file}
        />
      </div>

      <Card className="border-sky-200 bg-sky-50">
        <CardContent className="p-3">
          <p className="text-xs text-sky-800">
            Gender, colour and framing are detected automatically per article from
            extraction data — no need to pick them here.
          </p>
        </CardContent>
      </Card>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <Checkbox checked={generate} onCheckedChange={(v) => setGenerate(!!v)} />
        Generate model images &amp; store to <code className="rounded bg-muted px-1 py-0.5 text-[11px]">model-images</code> bucket
      </label>

      {articleCount > 0 && (!file || fileCount !== null) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-3">
            <p className="text-sm text-amber-700">
              {articleCount.toLocaleString()} articles &rarr; {imageCount.toLocaleString()} images (5 views each)
            </p>
          </CardContent>
        </Card>
      )}

      <Button
        type="button"
        size="lg"
        className="w-full bg-[#FF6F61] text-white hover:bg-[#ff5b4d] disabled:opacity-50"
        disabled={!canSubmit}
        onClick={() => onSubmit({ file, codesText })}
      >
        {submitting ? 'Starting…' : 'Generate from list'}
      </Button>

      {!generate && (
        <p className="text-xs text-muted-foreground text-center">
          Check the box above to enable generation.
        </p>
      )}
    </div>
  );
}
