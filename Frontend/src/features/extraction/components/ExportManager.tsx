import React, { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@/shared/components/ui-tw';
import { notification } from '@/lib/message';
import {
  ORDERED_EXPORT_HEADERS,
  buildExportSchema,
  exportToCSV,
  exportToExcel,
  exportToJSON,
  mapMasterAttributes,
  prepareExportData,
} from '../../../shared/utils/export/extractionExport';
import type { ExtractedRowEnhanced, SchemaItem } from '../../../shared/types/extraction/ExtractionTypes';
import { APP_CONFIG } from '../../../constants/app/config';

interface ExportManagerProps {
  extractedRows: ExtractedRowEnhanced[];
  schema: SchemaItem[];
  categoryName?: string;
  onClose: () => void;
}

type ExportFormat = 'excel' | 'csv' | 'json';

const ExportManager: React.FC<ExportManagerProps> = ({ extractedRows, schema, categoryName, onClose }) => {
  const [format, setFormat] = useState<ExportFormat>('excel');
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const [includeDiscoveries, setIncludeDiscoveries] = useState(false);
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>(schema.map((item) => item.key));
  const [masterAttributes, setMasterAttributes] = useState<SchemaItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Columns come from the master attribute list; each column's dropdown values come
  // from the page's schema (major-category / national grid), not attribute_allowed_values.
  const exportSchema = useMemo(() => {
    const gridValuesByKey = new Map(schema.map((item) => [item.key, item.allowedValues ?? []]));
    const masters = masterAttributes.map((attr) => ({ ...attr, allowedValues: gridValuesByKey.get(attr.key) ?? [] }));
    return buildExportSchema(schema, masters);
  }, [masterAttributes, schema]);
  const orderedHeaders = useMemo(() => [...ORDERED_EXPORT_HEADERS], []);

  useEffect(() => {
    const fetchMasterAttributes = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${APP_CONFIG.api.baseURL}/user/attributes`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) return;
        const result = await response.json().catch(() => null);
        const data = result?.data;
        if (!Array.isArray(data)) return;
        setMasterAttributes(mapMasterAttributes(data));
      } catch {
        /* fallback to current schema */
      }
    };
    fetchMasterAttributes();
  }, []);

  useEffect(() => {
    if (exportSchema.length > 0) setSelectedAttributes(exportSchema.map((item) => item.key));
  }, [exportSchema]);

  const prepareExport = useCallback(() => {
    return prepareExportData(extractedRows, exportSchema, orderedHeaders, includeMetadata, includeDiscoveries);
  }, [extractedRows, exportSchema, orderedHeaders, includeMetadata, includeDiscoveries]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setProgress(0);

    try {
      const exportData = prepareExport();
      setProgress(50);

      switch (format) {
        case 'excel':
          await exportToExcel(exportData, orderedHeaders, exportSchema, categoryName);
          break;
        case 'csv':
          await exportToCSV(exportData, categoryName);
          break;
        case 'json':
          await exportToJSON(exportData, exportSchema, categoryName);
          break;
      }

      setProgress(100);
      notification.success({
        message: 'Export Successful',
        description: `Data exported as ${format.toUpperCase()} file`,
      });
      setTimeout(onClose, 1000);
    } catch {
      notification.error({ message: 'Export Failed', description: 'An error occurred during export' });
    } finally {
      setExporting(false);
      setProgress(0);
    }
  }, [categoryName, exportSchema, format, onClose, orderedHeaders, prepareExport]);

  const formatIcon = {
    excel: <FileSpreadsheet className="h-4 w-4 text-emerald-700" />,
    csv: <FileText className="h-4 w-4 text-emerald-500" />,
    json: <FileText className="h-4 w-4 text-primary" />,
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Export Format</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="excel">
                <span className="flex items-center gap-2">
                  {formatIcon.excel} Excel Spreadsheet (.xlsx)
                </span>
              </SelectItem>
              <SelectItem value="csv">
                <span className="flex items-center gap-2">{formatIcon.csv} CSV File (.csv)</span>
              </SelectItem>
              <SelectItem value="json">
                <span className="flex items-center gap-2">{formatIcon.json} JSON Data (.json)</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Attributes to Export ({exportSchema.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[200px] overflow-y-auto">
            <label className="mb-2 flex items-center gap-2">
              <Checkbox
                checked={true}
                onCheckedChange={() => setSelectedAttributes(exportSchema.map((item) => item.key))}
              />
              <span>All attributes included</span>
            </label>
            <Separator className="my-2" />
            <div className="flex flex-col gap-2">
              {exportSchema.map((item) => (
                <label key={item.key} className="flex items-center gap-2">
                  <Checkbox checked={selectedAttributes.includes(item.key)} disabled />
                  <span>{item.label}</span>
                  {item.required && (
                    <span className="text-[11px] text-muted-foreground">(Required)</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Export Options</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <label className="flex items-center gap-2">
            <Checkbox checked={includeMetadata} onCheckedChange={(v) => setIncludeMetadata(!!v)} />
            <span>Include AI metadata (confidence scores, processing time, token usage)</span>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={includeDiscoveries} onCheckedChange={(v) => setIncludeDiscoveries(!!v)} />
            <span>Include AI discoveries (additional attributes found)</span>
          </label>
        </CardContent>
      </Card>

      {exporting && (
        <Progress
          value={progress}
          indicatorClassName="bg-gradient-to-r from-[#FF6F61] to-[#FFA62B]"
        />
      )}

      <Card className="bg-muted/30">
        <CardContent className="flex flex-col gap-1 pt-6">
          <strong>Export Summary:</strong>
          <span>• {extractedRows.length} images will be exported</span>
          <span>• {selectedAttributes.length} attributes per image</span>
          <span>• Format: {format.toUpperCase()}</span>
          {includeMetadata && <span>• AI metadata included</span>}
          {includeDiscoveries && <span>• Discovery data included</span>}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleExport} disabled={exporting || selectedAttributes.length === 0}>
          <Download />
          {exporting ? 'Exporting...' : `Export ${format.toUpperCase()}`}
        </Button>
      </div>
    </div>
  );
};

export default memo(ExportManager);
