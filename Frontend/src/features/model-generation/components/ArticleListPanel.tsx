import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  FormItem,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/shared/components/ui-tw';

export interface ArticleListSubmit {
  file: File | null;
  codesText: string;
  gender: string;
  bodytype: string;
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

const GENDER_OPTIONS = [
  { label: 'Female', value: 'female' },
  { label: 'Male', value: 'male' },
  { label: 'Kid Boy', value: 'kid boy' },
  { label: 'Kid Girl', value: 'kid girl' },
];

const BODYTYPE_OPTIONS = [
  { label: 'Full Body', value: 'Full-Body' },
  { label: 'Upper Body', value: 'Upper-Body' },
  { label: 'Lower Body', value: 'Lower-Body' },
];

export function ArticleListPanel({ submitting, onSubmit }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [codesText, setCodesText] = useState('');
  const [gender, setGender] = useState('female');
  const [bodytype, setBodytype] = useState('Full-Body');
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
      <FormItem>
        <FormLabel>Article list (.xlsx / .csv)</FormLabel>
        <Input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
        {file && fileCount !== null && (
          <p className="text-xs text-muted-foreground mt-1">{fileCount} unique article codes detected</p>
        )}
        {fileError && <p className="text-xs text-destructive mt-1">{fileError}</p>}
      </FormItem>

      <FormItem>
        <FormLabel>…or paste codes (one FINAL ART per line)</FormLabel>
        <Textarea
          rows={5}
          className="resize-y"
          placeholder={'1110097922-BLACK\n1110106859-DARK GREY'}
          value={codesText}
          onChange={(e) => setCodesText(e.target.value)}
          disabled={!!file}
        />
      </FormItem>

      <div className="grid grid-cols-2 gap-3">
        <FormItem>
          <FormLabel>Gender</FormLabel>
          <Select value={gender} onValueChange={setGender}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
        <FormItem>
          <FormLabel>Body Type</FormLabel>
          <Select value={bodytype} onValueChange={setBodytype}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BODYTYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
      </div>

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
        onClick={() => onSubmit({ file, codesText, gender, bodytype })}
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
