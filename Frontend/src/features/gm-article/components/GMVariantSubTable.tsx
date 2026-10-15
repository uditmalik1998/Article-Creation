import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Pencil, Plus } from 'lucide-react';
import {
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
} from '@/shared/components/ui-tw';
import { message } from '@/lib/message';
import { APP_CONFIG } from '../../../constants/app/config';
import VariantGrid, { StatusPill } from '../../approver/components/VariantGrid';
import GMAddColorModal from './GMAddColorModal';
import type { ApproverItem, MasterAttribute } from './GMArticleTable';


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
        gsm: v.gsm != null ? String(v.gsm) : '',
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

// ── Main GMVariantSubTable ────────────────────────────────────────────────────

const GMVariantSubTable: React.FC<VariantSubTableProps> = ({
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
  const [deletingColor, setDeletingColor] = useState<string | null>(null);

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

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants, genericRecord.approvalStatus, genericRecord.sapArticleId]);

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

  const existingPairs = new Set(
    variants
      .filter((v) => v.variantSize && v.variantColor)
      .map((v) => `${String(v.variantSize).trim().toUpperCase()}||${String(v.variantColor).trim().toUpperCase()}`),
  );

  const handleVariantSaved = useCallback(() => {
    fetchVariants();
  }, [fetchVariants]);

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

  // ── Grid wiring (shared VariantGrid, design "Option E") ───────────────────
  // Only variants still pending approval can be deleted (unchanged rule).
  const isPendingVariant = (v: ApproverItem) => !v.sapArticleId && (!v.approvalStatus || v.approvalStatus === 'PENDING');

  const deleteVariants = async (ids: string[]) => {
    const token = localStorage.getItem('authToken');
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`${APP_CONFIG.api.baseURL}/approver/items/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ),
    );
    const failed = results.filter((r) => !r.ok).length;
    if (failed) message.error(`${failed} variant${failed !== 1 ? 's' : ''} could not be deleted`);
    else message.success(`Deleted ${ids.length} variant${ids.length !== 1 ? 's' : ''}`);
    fetchVariants();
  };

  const handleDeleteColorVariants = async (color: string) => {
    const ids = variants.filter((v) => (v.variantColor || '').toUpperCase() === color).map((v) => v.id);
    setDeletingColor(color);
    try {
      await deleteVariants(ids);
    } finally {
      setDeletingColor(null);
    }
  };

  const renderStatus = (v: ApproverItem) => {
    if (v.sapArticleId) return <StatusPill tone="green">Synced</StatusPill>;
    if (v.sapSyncStatus === 'FAILED') {
      return <StatusPill tone="red" tooltip={v.sapSyncMessage || 'SAP returned an error'}>Failed</StatusPill>;
    }
    if (v.sapSyncStatus === 'SYNCED') return <StatusPill tone="amber">Synced, no #</StatusPill>;
    if (v.approvalStatus === 'REJECTED') return <StatusPill tone="red">Rejected</StatusPill>;
    if (v.approvalStatus === 'APPROVED') return <StatusPill tone="slate">Pending SAP</StatusPill>;
    return <StatusPill tone="amber">Pending approval</StatusPill>;
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
    <div>
      <VariantGrid<ApproverItem>
        variants={variants}
        fallbackColor={genericRecord.colour}
        isSelectable={isPendingVariant}
        isDeletable={isPendingVariant}
        onBulkDelete={deleteVariants}
        canDeleteColor={(_color, rows) => rows.length > 0 && !!rows[0].variantColor && rows.every(isPendingVariant)}
        onDeleteColor={handleDeleteColorVariants}
        deletingColor={deletingColor}
        renderStatus={renderStatus}
        renderRowAction={(v) =>
          !v.fabricArticleNumber ? (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setEditingVariant(v)}>
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          ) : null
        }
        toolbarActions={
          <>
            {pathType === 'created' && retryNeededCount > 0 && (
              <Button size="sm" variant="destructive" className="h-7 text-[12px]" disabled={retrying} onClick={handleRetryVariants}>
                {retrying ? 'Retrying…' : `Retry Variants to SAP (${retryNeededCount})`}
              </Button>
            )}
            <Button size="sm" className="h-7 bg-slate-800 text-[12px] text-white hover:bg-slate-900" onClick={() => setAddColorOpen(true)}>
              <Plus />
              Add Color
            </Button>
          </>
        }
      />

      <EditVariantModal
        open={!!editingVariant}
        variant={editingVariant}
        attributes={attributes}
        onClose={() => setEditingVariant(null)}
        onSaved={handleVariantSaved}
      />

      <GMAddColorModal
        open={addColorOpen}
        genericId={genericId}
        majorCategory={genericRecord.majorCategory || ''}
        existingPairs={existingPairs}
        attributes={attributes}
        source="flat"
        onClose={() => setAddColorOpen(false)}
        onAdded={handleVariantSaved}
      />
    </div>
  );
};

export default GMVariantSubTable;
