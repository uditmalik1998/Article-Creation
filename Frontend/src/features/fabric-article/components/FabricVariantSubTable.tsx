import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pencil, Trash2, Plus, Info } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Input,
  MultiSelect,
  Popconfirm,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tag,
  Textarea,
  Tooltip,
  type DataTableColumn,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import type { ApproverItem, MasterAttribute } from './FabricArticleTable';

const FALLBACK_COLORS = ['BLACK', 'WHITE', 'RED', 'NAVY', 'GREY', 'BLUE', 'GREEN'];

interface VariantSubTableProps {
  genericId: string;
  genericRecord: ApproverItem;
  onRefresh: () => void;
  attributes: MasterAttribute[];
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
}

// ── Edit variant modal ────────────────────────────────────────────────────────

interface VariantFormValues {
  variantSize?: string;
  variantColor?: string;
  yarn1?: string;
  yarn2?: string;
  weave?: string;
  mFab2?: string;
  fabricMainMvgr?: string;
  macroMvgr?: string;
  mainMvgr?: string;
  lycra?: string;
  neck?: string;
  neckDetails?: string;
  collar?: string;
  placket?: string;
  sleeve?: string;
  bottomFold?: string;
  frontOpenStyle?: string;
  pocketType?: string;
  fit?: string;
  pattern?: string;
  length?: string;
  fatherBelt?: string;
  childBelt?: string;
  printType?: string;
  printStyle?: string;
  printPlacement?: string;
  embroidery?: string;
  embroideryType?: string;
  patches?: string;
  patchesType?: string;
  wash?: string;
  shade?: string;
  composition?: string;
  finish?: string;
  gsm?: string;
  weight?: string;
  drawcord?: string;
  button?: string;
  zipper?: string;
  zipColour?: string;
  rate?: string;
  mrp?: string;
  vendorCode?: string;
  designNumber?: string;
  pptNumber?: string;
  articleDescription?: string;
}

interface EditVariantModalProps {
  open: boolean;
  variant: ApproverItem | null;
  attributes: MasterAttribute[];
  onClose: () => void;
  onSaved: () => void;
}

const TEXT_FIELDS: { name: keyof VariantFormValues; label: string }[] = [
  { name: 'yarn1', label: 'Yarn 1' },
  { name: 'yarn2', label: 'Yarn 2' },
  { name: 'weave', label: 'Weave' },
  { name: 'mFab2', label: 'M FAB 2' },
  { name: 'fabricMainMvgr', label: 'Fabric Main MVGR' },
  { name: 'macroMvgr', label: 'Macro MVGR' },
  { name: 'mainMvgr', label: 'Main MVGR' },
  { name: 'lycra', label: 'Lycra' },
  { name: 'neckDetails', label: 'Neck Details' },
  { name: 'collar', label: 'Collar' },
  { name: 'placket', label: 'Placket' },
  { name: 'sleeve', label: 'Sleeve' },
  { name: 'bottomFold', label: 'Bottom Fold' },
  { name: 'frontOpenStyle', label: 'Front Open Style' },
  { name: 'pocketType', label: 'Pocket Type' },
  { name: 'fit', label: 'Fit' },
  { name: 'pattern', label: 'Pattern' },
  { name: 'length', label: 'Length' },
  { name: 'fatherBelt', label: 'Father Belt' },
  { name: 'childBelt', label: 'Child Belt' },
  { name: 'wash', label: 'Wash' },
  { name: 'shade', label: 'Shade' },
  { name: 'composition', label: 'Composition' },
  { name: 'finish', label: 'Finish' },
  { name: 'gsm', label: 'GSM' },
  { name: 'weight', label: 'Weight' },
  { name: 'printType', label: 'Print Type' },
  { name: 'printStyle', label: 'Print Style' },
  { name: 'printPlacement', label: 'Print Placement' },
  { name: 'embroidery', label: 'Embroidery' },
  { name: 'embroideryType', label: 'Embroidery Type' },
  { name: 'patches', label: 'Patches' },
  { name: 'patchesType', label: 'Patches Type' },
  { name: 'drawcord', label: 'Drawcord' },
  { name: 'button', label: 'Button' },
  { name: 'zipper', label: 'Zipper' },
  { name: 'zipColour', label: 'Zip Colour' },
  { name: 'rate', label: 'Rate' },
  { name: 'mrp', label: 'MRP' },
  { name: 'vendorCode', label: 'Vendor Code' },
  { name: 'designNumber', label: 'Design Number' },
  { name: 'pptNumber', label: 'PPT Number' },
];

const EditVariantModal: React.FC<EditVariantModalProps> = ({ open, variant, attributes, onClose, onSaved }) => {
  const form = useForm<VariantFormValues>({ defaultValues: {} });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && variant) {
      const v = variant;
      form.reset({
        variantSize: v.variantSize ?? '',
        variantColor: v.variantColor ?? '',
        yarn1: v.yarn1 ?? '',
        yarn2: v.yarn2 ?? '',
        weave: v.weave ?? '',
        mFab2: v.mFab2 ?? '',
        fabricMainMvgr: v.fabricMainMvgr ?? '',
        macroMvgr: v.macroMvgr ?? '',
        mainMvgr: v.mainMvgr ?? '',
        lycra: v.lycra ?? '',
        neck: v.neck ?? '',
        neckDetails: v.neckDetails ?? '',
        collar: v.collar ?? '',
        placket: v.placket ?? '',
        sleeve: v.sleeve ?? '',
        bottomFold: v.bottomFold ?? '',
        frontOpenStyle: v.frontOpenStyle ?? '',
        pocketType: v.pocketType ?? '',
        fit: v.fit ?? '',
        pattern: v.pattern ?? '',
        length: v.length ?? '',
        fatherBelt: v.fatherBelt ?? '',
        childBelt: v.childBelt ?? '',
        printType: v.printType ?? '',
        printStyle: v.printStyle ?? '',
        printPlacement: v.printPlacement ?? '',
        embroidery: v.embroidery ?? '',
        embroideryType: v.embroideryType ?? '',
        patches: v.patches ?? '',
        patchesType: v.patchesType ?? '',
        wash: v.wash ?? '',
        shade: v.shade ?? '',
        composition: v.composition ?? '',
        finish: v.finish ?? '',
        gsm: v.gsm ?? '',
        weight: v.weight ?? '',
        drawcord: v.drawcord ?? '',
        button: v.button ?? '',
        zipper: v.zipper ?? '',
        zipColour: v.zipColour ?? '',
        rate: v.rate != null ? String(v.rate) : '',
        mrp: v.mrp != null ? String(v.mrp) : '',
        vendorCode: v.vendorCode ?? '',
        designNumber: v.designNumber ?? '',
        pptNumber: v.pptNumber ?? '',
        articleDescription: v.articleDescription ?? '',
      });
    }
  }, [open, variant, form]);

  const onSubmit = async (values: VariantFormValues) => {
    if (!variant) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const { variantSize: _omit, ...payload } = values;
      void _omit;
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${variant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const payload2 = await response.json().catch(() => null);
        throw new Error(payload2?.error || 'Failed to update variant');
      }
      message.success('Variant updated');
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to update variant');
    } finally {
      setSaving(false);
    }
  };

  const neckOptions = attributes.find((a) => a.key === 'NECK')?.allowedValues ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[720px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Variant{variant?.variantSize ? ` — Size ${variant.variantSize}` : ''}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="variantSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Size (read-only)</FormLabel>
                    <FormControl>
                      <Input disabled {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="variantColor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. RED, NAVY BLUE" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="neck"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Neck</FormLabel>
                  <FormControl>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {neckOptions.map((v) => (
                          <SelectItem key={v.shortForm} value={v.shortForm}>
                            {v.shortForm}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              {TEXT_FIELDS.map(({ name, label }) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <FormField
              control={form.control}
              name="articleDescription"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Article Description</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value ?? ''} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// ── Add Color modal ───────────────────────────────────────────────────────────

interface AddColorModalProps {
  open: boolean;
  genericId: string;
  majorCategory: string;
  existingColors: string[];
  /** Existing (size, color) pairs already created, as `SIZE||COLOR` (upper-cased). */
  existingPairs: Set<string>;
  sizeCount: number;
  attributes: MasterAttribute[];
  onClose: () => void;
  onAdded: () => void;
}

const AddColorModal: React.FC<AddColorModalProps> = ({
  open,
  genericId,
  majorCategory,
  existingColors,
  existingPairs,
  sizeCount,
  attributes,
  onClose,
  onAdded,
}) => {
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [masterColors, setMasterColors] = useState<{ code: string; name: string }[]>([]);
  // Step 2: per-color image upload. step 1 = pick colors/sizes, step 2 = upload images.
  const [step, setStep] = useState<1 | 2>(1);
  const [colorImages, setColorImages] = useState<Record<string, string>>({}); // color code → uploaded URL
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) { setSelectedColors([]); setStep(1); setColorImages({}); setUploading({}); return; }
    const token = localStorage.getItem('authToken');
    // Colors from the color_master table.
    fetch(`${APP_CONFIG.api.baseURL}/approver/colors`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : { colors: [] }))
      .then((d) => setMasterColors(Array.isArray(d?.colors) ? d.colors : []))
      .catch(() => setMasterColors([]));
  }, [open, majorCategory]);

  // color code → "Name - CODE" label for the image step.
  const colorLabel = (code: string) => {
    const m = masterColors.find((c) => c.code.toUpperCase() === code.toUpperCase());
    return m ? `${m.name} - ${m.code}` : code;
  };

  const uploadColorImage = async (code: string, file: File) => {
    setUploading((u) => ({ ...u, [code]: true }));
    try {
      const token = localStorage.getItem('authToken');
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch(`${APP_CONFIG.api.baseURL}/approver/upload-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!r.ok) throw new Error('Upload failed');
      const d = await r.json();
      setColorImages((m) => ({ ...m, [code]: d.url }));
    } catch {
      message.error(`Failed to upload image for ${code}`);
    } finally {
      setUploading((u) => ({ ...u, [code]: false }));
    }
  };

  const anyUploading = Object.values(uploading).some(Boolean);
  const allImagesReady = selectedColors.length > 0 && selectedColors.every((c) => !!colorImages[c]);

  const handleNext = () => {
    if (selectedColors.length === 0) { message.warning('Please select at least one color'); return; }
    setStep(2);
  };

  const handleOk = async () => {
    if (selectedColors.length === 0) {
      message.warning('Please select at least one color');
      return;
    }
    if (!allImagesReady) {
      message.warning('Upload an image for every color');
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('authToken');
      const body = { colors: selectedColors, colorImages };
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/add-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || payload?.error || 'Failed to add color variants');
      }
      const result = await response.json();
      message.success(`${result.count} variant${result.count !== 1 ? 's' : ''} created`);
      onAdded();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Failed to add colors');
    } finally {
      setSaving(false);
    }
  };

  const colorAttr = attributes.find(
    (a) =>
      a.key.toUpperCase() === 'COLOR' ||
      a.key.toLowerCase() === 'colour' ||
      a.label.toUpperCase() === 'COLOR' ||
      a.label.toUpperCase() === 'COLOUR',
  );

  const isColorDisabled = (code: string, label?: string): boolean => {
    const codeU = code.toUpperCase();
    const labelU = label?.toUpperCase();
    return existingColors.some((ec) => ec.toUpperCase() === codeU || (labelU ? ec.toUpperCase() === labelU : false));
  };

  // Colors come from the color_master table (child_color + sap_create_old).
  // value  = sap_create_old (stored on the variant), label = "CHILD COLOR - SAP_CODE".
  // Falls back to the COLOR attribute / hardcoded list only if color_master is unavailable.
  const options =
    masterColors.length > 0
      ? masterColors.map((c) => ({
          value: c.code,
          label: `${c.name} - ${c.code}`,
          disabled: isColorDisabled(c.code),
        }))
      : (colorAttr && colorAttr.allowedValues.length > 0
          ? colorAttr.allowedValues.map((v) => ({ code: v.shortForm, label: v.fullForm }))
          : FALLBACK_COLORS.map((c) => ({ code: c, label: c }))
        ).map(({ code, label }) => ({
          value: code,
          label: label !== code ? `${code} — ${label}` : code,
          disabled: isColorDisabled(code, label),
        }));

  const variantPreview =
      selectedColors.length > 0 && sizeCount > 0
      ? `${selectedColors.length} color${selectedColors.length > 1 ? 's' : ''} × ${sizeCount} size${
          sizeCount > 1 ? 's' : ''
        } = ${selectedColors.length * sizeCount} variants`
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Color Variants</DialogTitle>
        </DialogHeader>

        {step === 1 && (
        <>
        <p className="mb-3 text-sm text-muted-foreground">
          Select one or more colors. One variant will be created per size for each color.
        </p>
        <MultiSelect
          options={options}
          value={selectedColors}
          onChange={setSelectedColors}
          placeholder="Select colors…"
          searchable
          searchPlaceholder="Search colors…"
        />

        {variantPreview && (
          <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5">
            <span className="text-[13px] text-emerald-700">
              Will create: <strong>{variantPreview}</strong>
            </span>
          </div>
        )}

        {existingColors.length > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Already added:{' '}
            {existingColors.map((c) => (
              <Tag key={c} className="ml-1">
                {c}
              </Tag>
            ))}
          </div>
        )}
        </>
        )}

        {/* Step 2 — per-color image upload */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Upload an image for each color. That image is applied to all sizes of the color.
            </p>
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {selectedColors.map((code) => {
                const url = colorImages[code];
                const busy = uploading[code];
                return (
                  <div key={code} className="flex items-center gap-3 rounded-md border border-border p-2">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                      {url ? (
                        <img src={url} alt={code} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{colorLabel(code)}</div>
                      <div
                        className={
                          'text-[11px] ' +
                          (busy ? 'text-muted-foreground' : url ? 'text-emerald-600' : 'text-rose-600')
                        }
                      >
                        {busy ? 'Uploading…' : url ? 'Image uploaded' : 'Required'}
                      </div>
                    </div>
                    <label className="shrink-0 cursor-pointer rounded-md border border-input bg-background px-2.5 py-1 text-[12px] hover:bg-muted">
                      {url ? 'Replace' : 'Upload'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadColorImage(code, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleNext}
                disabled={selectedColors.length === 0}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={saving || anyUploading}>
                Back
              </Button>
              <Button onClick={handleOk} disabled={saving || anyUploading || !allImagesReady}>
                {saving ? 'Adding…' : 'Add Colors'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Main VariantSubTable ──────────────────────────────────────────────────────

const FabricVariantSubTable: React.FC<VariantSubTableProps> = ({
  genericId,
  genericRecord,
  attributes,
  onRefresh,
  pathType,
}) => {
  const [variants, setVariants] = useState<ApproverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ApproverItem | null>(null);
  const [addColorOpen, setAddColorOpen] = useState(false);
  const [majCatSizeCount, setMajCatSizeCount] = useState<number | null>(null);

  const fetchVariants = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/variants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch variants');
      const result = await response.json();
      setVariants(result.data || result);
    } catch {
      if (!silent) message.error('Failed to load variants');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [genericId]);

  // Refetch on mount/genericId change, AND when the generic is approved/synced
  // (Save & Submit flips approvalStatus → APPROVED and sets sapArticleId) so the
  // variant rows refresh to show their updated status / SAP article numbers.
  useEffect(() => {
    fetchVariants();
  }, [fetchVariants, genericRecord.approvalStatus, genericRecord.sapArticleId]);

  // Variants sync to SAP a bit AFTER the generic, so the first refetch above often
  // still shows them "Pending SAP". Quietly re-poll every 5s while the generic is
  // APPROVED and any variant is still un-synced, so their SAP numbers/status appear
  // without a hard refresh. Self-stops once all variants resolve (or after 3 min).
  const variantPollElapsedRef = useRef(0);
  useEffect(() => { variantPollElapsedRef.current = 0; }, [genericId]);
  useEffect(() => {
    if (genericRecord.approvalStatus !== 'APPROVED') return;
    const anyPending = variants.some(
      (v) => v.sapSyncStatus === 'PENDING' || v.sapSyncStatus === 'NOT_SYNCED',
    );
    if (!anyPending || variantPollElapsedRef.current >= 180) return;
    const t = window.setTimeout(() => {
      variantPollElapsedRef.current += 5;
      void fetchVariants(true);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [variants, genericRecord.approvalStatus, fetchVariants]);

  useEffect(() => {
    const majCat = genericRecord.majorCategory;
    if (!majCat) return;
    const token = localStorage.getItem('authToken');
    fetch(`${APP_CONFIG.api.baseURL}/approver/sizes-for-majcat/${encodeURIComponent(majCat)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setMajCatSizeCount(d.count ?? null))
      .catch(() => setMajCatSizeCount(null));
  }, [genericRecord.majorCategory]);

  const existingColors = Array.from(
    new Set(variants.map((v) => v.variantColor).filter((c): c is string => Boolean(c))),
  );

  // Existing (size, color) combinations, so the Add-Color modal can tell apart
  // "this color exists for some sizes" from "this exact size × color exists".
  const existingPairs = new Set(
    variants
      .filter((v) => v.variantSize && v.variantColor)
      .map((v) => `${String(v.variantSize).trim().toUpperCase()}||${String(v.variantColor).trim().toUpperCase()}`),
  );

  const sizeCount =
    majCatSizeCount ?? Array.from(new Set(variants.map((v) => v.variantSize).filter(Boolean))).length;

  const handleVariantSaved = useCallback(() => {
    fetchVariants();
  }, [fetchVariants]);

  const handleDeleteVariant = useCallback(
    async (variantId: string) => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${variantId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'Failed to delete variant');
        }
        message.success('Variant deleted');
        fetchVariants();
      } catch (err) {
        message.error(err instanceof Error ? err.message : 'Failed to delete variant');
      }
    },
    [fetchVariants],
  );

  const handleRetryVariants = useCallback(async () => {
    setRetrying(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/retry-variants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Retry failed');
      message.success(data.message || `${data.synced} synced, ${data.failed} failed`);
      fetchVariants();
      onRefresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }, [genericId, fetchVariants, onRefresh]);

  const columns: DataTableColumn<ApproverItem>[] = [
    {
      title: 'Size',
      dataIndex: 'variantSize',
      key: 'variantSize',
      width: 90,
      render: (v: string | null) => v || <span className="text-muted-foreground">—</span>,
    },
    {
      title: 'Color',
      dataIndex: 'variantColor',
      key: 'variantColor',
      width: 140,
      render: (v, record) => {
        const display = v || record.colour || genericRecord.colour;
        return display ? <Badge variant="info">{display}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      title: 'Status',
      dataIndex: 'approvalStatus',
      key: 'approvalStatus',
      width: 100,
      render: (status: string) => {
        const variant: 'success' | 'destructive' | 'warning' =
          status === 'APPROVED' ? 'success' : status === 'REJECTED' ? 'destructive' : 'warning';
        return <Badge variant={variant}>{status || 'PENDING'}</Badge>;
      },
    },
    {
      title: 'Major Category',
      dataIndex: 'majorCategory',
      key: 'majorCategory',
      width: 160,
      render: (v) => v || <span className="text-muted-foreground">—</span>,
    },
    {
      title: 'Division',
      dataIndex: 'division',
      key: 'division',
      width: 100,
      render: (v) => v || <span className="text-muted-foreground">—</span>,
    },
    {
      title: 'Vendor',
      key: 'vendor',
      width: 140,
      render: (_v, record) =>
        record.vendorName || record.vendorCode || <span className="text-muted-foreground">—</span>,
    },
    {
      title: 'Rate',
      dataIndex: 'rate',
      key: 'rate',
      width: 80,
      render: (v) => (v != null ? String(v) : '—'),
    },
    {
      title: 'MRP',
      dataIndex: 'mrp',
      key: 'mrp',
      width: 80,
      render: (v) => (v != null ? String(v) : '—'),
    },
    {
      title: 'SAP Article #',
      dataIndex: 'sapArticleId',
      key: 'sapArticleId',
      width: 140,
      render: (sapId, record) => {
        if (sapId) return <strong className="text-xs text-emerald-700">{sapId}</strong>;
        const status = record.sapSyncStatus;
        if (status === 'FAILED') {
          return (
            <Tooltip title={record.sapSyncMessage || 'SAP returned an error'} side="top">
              <Badge variant="destructive" className="cursor-help gap-1 text-[11px]">
                FAILED <Info className="h-3 w-3" />
              </Badge>
            </Tooltip>
          );
        }
        if (status === 'SYNCED') return <Badge variant="warning" className="text-[11px]">SYNCED</Badge>;
        return <span className="text-[11px] text-muted-foreground">Pending SAP</span>;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_v, record) => (
        <div className="flex gap-1.5">
          {!record.fabricArticleNumber && (
            <Button size="sm" variant="outline" onClick={() => setEditingVariant(record)}>
              <Pencil />
              Edit
            </Button>
          )}
          {(!record.approvalStatus || record.approvalStatus === 'PENDING') && (
            <Popconfirm
              title="Delete variant?"
              description="This cannot be undone."
              onConfirm={() => handleDeleteVariant(record.id)}
              okText="Delete"
            >
              <Button size="sm" variant="destructive">
                <Trash2 />
              </Button>
            </Popconfirm>
          )}
        </div>
      ),
    },
  ];

  const handleSyncColor = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const res = await fetch(`${APP_CONFIG.api.baseURL}/approver/items/${genericId}/sync-color`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.count > 0) {
        message.success(`Colour synced to ${data.count} variants`);
        fetchVariants();
      } else {
        message.info(data.message || 'Nothing to sync');
      }
    } catch {
      message.error('Failed to sync colour');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4">
        <Spinner size="sm" />
        <span className="text-sm text-muted-foreground">Loading variants…</span>
      </div>
    );
  }

  const retryNeededCount = variants.filter(
    (v) =>
      v.sapSyncStatus === 'FAILED' ||
      (v.approvalStatus === 'APPROVED' && v.sapSyncStatus === 'NOT_SYNCED') ||
      v.approvalStatus === 'PENDING',
  ).length;

  return (
    <div className="rounded-md bg-muted/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <strong className="text-[13px]">Variants ({variants.length})</strong>
        <div className="flex items-center gap-2">
          {genericRecord.colour && (
            <Button size="sm" variant="outline" onClick={handleSyncColor}>
              Sync Color
            </Button>
          )}
          {pathType === 'created' && retryNeededCount > 0 && (
            <Button size="sm" variant="destructive" disabled={retrying} onClick={handleRetryVariants}>
              {retrying ? 'Retrying…' : `Retry Variants to SAP (${retryNeededCount})`}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAddColorOpen(true)}>
            <Plus />
            Add Color
          </Button>
        </div>
      </div>

      {variants.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No variants yet. Use "Add Color" to create color variants.
        </span>
      ) : (
        <DataTable<ApproverItem>
          columns={columns}
          dataSource={variants}
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
        />
      )}

      <EditVariantModal
        open={!!editingVariant}
        variant={editingVariant}
        attributes={attributes}
        onClose={() => setEditingVariant(null)}
        onSaved={handleVariantSaved}
      />

      <AddColorModal
        open={addColorOpen}
        genericId={genericId}
        majorCategory={genericRecord.majorCategory || ''}
        existingColors={existingColors}
        existingPairs={existingPairs}
        sizeCount={sizeCount}
        attributes={attributes}
        onClose={() => setAddColorOpen(false)}
        onAdded={handleVariantSaved}
      />
    </div>
  );
};

export default FabricVariantSubTable;
