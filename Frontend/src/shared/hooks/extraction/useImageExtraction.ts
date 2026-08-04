/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { message } from "@/lib/message";
import { addNotification } from "../../services/notifications/notificationStore";
import { BackendApiService } from "../../../services/api/backendApi";
import { APP_CONFIG } from '../../../constants/app/config';
import { discoveryManager } from "../../services/ai/discovery/discoveryManager";
import { ImageCompressionService } from "../../services/processing/ImageCompressionService";
import type {
  SchemaItem,
  DiscoveredAttribute,
  EnhancedExtractionResult,
  ExtractedRowEnhanced,
  DiscoverySettings,
  PerformanceMetrics,
  ExtractionError,
} from "../../types/extraction/ExtractionTypes";
import {
  getMemoryUsage,
  getMemoryInfo,
  createExtractedRow,
  compressImage,
} from "./extractionHelpers";
import { useBatchExtraction } from "./useBatchExtraction";
import { AttributeProcessor } from "../../services/extraction/rangeAwareProcessor";

let globalExtractedRows: ExtractedRowEnhanced[] = [];
let globalIsExtracting = false;
let globalProgress = 0;

const buildScopeAttribute = (value: string, reasoning: string) => ({
  rawValue: value,
  schemaValue: value,
  visualConfidence: 100,
  mappingConfidence: 100,
  isNewDiscovery: false,
  reasoning,
  isUserEdited: false,
});

const parseSelectedScope = (categoryCode?: string, categoryName?: string) => {
  const scopeText = String(categoryCode || categoryName || '').trim();
  if (!scopeText) {
    return { division: null, subDivision: null };
  }

  const separatorIndex = scopeText.indexOf('-');
  if (separatorIndex === -1) {
    return { division: scopeText, subDivision: null };
  }

  const division = scopeText.slice(0, separatorIndex).trim();
  const subDivision = scopeText.slice(separatorIndex + 1).trim();

  return {
    division: division || null,
    subDivision: subDivision || null
  };
};

export const resetExtractionSession = () => {
  globalExtractedRows = [];
  globalIsExtracting = false;
  globalProgress = 0;
};

export const useImageExtraction = () => {
  // Core state
  const [isExtracting, setIsExtracting] = useState(globalIsExtracting);
  const [extractedRows, setExtractedRows] = useState<ExtractedRowEnhanced[]>(globalExtractedRows);
  const [progress, setProgress] = useState(globalProgress);

  // Metadata state
  const [currentMetadata, setCurrentMetadata] = useState<{
    vendorName?: string;
    designNumber?: string;
    pptNumber?: string;
    costPrice?: number;
    sellingPrice?: number;
    notes?: string;
  }>({});

  const [currentCategoryCode, setCurrentCategoryCode] = useState<string>();

  // Discovery state
  const [discoverySettings, setDiscoverySettings] = useState<DiscoverySettings>({
    enabled: false, // 🔧 DEFAULT TO FALSE - Only enable when explicitly needed
    minConfidence: 70,
    showInTable: true,
    autoPromote: false,
    maxDiscoveries: 10,
  });
  const [globalDiscoveries, setGlobalDiscoveries] = useState<DiscoveredAttribute[]>([]);
  // Analytics
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics[]>([]);
  const [extractionErrors, setExtractionErrors] = useState<ExtractionError[]>([]);
  const [batchResults] = useState<any[]>([]);

  const compressionService = useMemo(() => new ImageCompressionService(), []);

  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateRows = useCallback(
    (updater: ExtractedRowEnhanced[] | ((prev: ExtractedRowEnhanced[]) => ExtractedRowEnhanced[])) => {
      const next = typeof updater === 'function'
        ? (updater as (prev: ExtractedRowEnhanced[]) => ExtractedRowEnhanced[])(globalExtractedRows)
        : updater;
      globalExtractedRows = next;
      if (isMountedRef.current) {
        setExtractedRows(next);
      }
      return next;
    },
    []
  );

  const updateProgress = useCallback((value: number) => {
    globalProgress = value;
    if (isMountedRef.current) {
      setProgress(value);
    }
  }, []);

  const updateIsExtracting = useCallback((value: boolean) => {
    globalIsExtracting = value;
    if (isMountedRef.current) {
      setIsExtracting(value);
    }
  }, []);

  const recordPerf = useCallback((metrics: PerformanceMetrics) => {
    setPerformanceMetrics((prev) => [...prev, metrics]);
  }, []);

  const compress = useCallback(
    (file: File, _onProgress?: (p: number) => void): Promise<string> =>
      compressImage(file, compressionService, recordPerf),
    [compressionService, recordPerf]
  );

  const newRow = useCallback(
    (file: File) => createExtractedRow(file, compress),
    [compress]
  );

  const backendApi = useMemo(() => new BackendApiService(), []);

  // Extract attributes with proper error handling and user notification
  const extractImageAttributes = useCallback(
    async (
      row: ExtractedRowEnhanced,
      schema: SchemaItem[],
      categoryName?: string,
      categoryCode?: string,
      metadata?: {
        vendorName?: string;
        designNumber?: string;
        pptNumber?: string;
        costPrice?: number;
        sellingPrice?: number;
        notes?: string;
      },
      presentationsType?: string,
    ) => {
      const discoveryEnabled = discoverySettings.enabled;
      addNotification({
        title: "Extraction started",
        description: `${row.originalFileName} is being processed.`,
        type: "info",
      });
      updateRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
              ...r,
              status: "Extracting",
              processingProgress: 0,
              error: undefined,
            }
            : r
        )
      );

      const start = performance.now();
      try {
        const relativePath = ((row.file as File & { webkitRelativePath?: string }).webkitRelativePath || '').trim();
        const folderName = relativePath.includes('/') ? relativePath.split('/')[0] : undefined;

        // Convert file to base64 using compression service
        const base64Image = await compress(row.file);

        // 🔧 VALIDATION: Only enable discovery mode when explicitly set
        console.log(`🔍 Frontend Extraction - Discovery Enabled: ${discoveryEnabled}, Category: ${categoryName}, Code: ${categoryCode}, Has Metadata: ${!!metadata}`);

        // Use category-based extraction if category code and metadata are provided
        let result: EnhancedExtractionResult;
        if (categoryCode && metadata && Object.keys(metadata).length > 0) {
          console.log(`Using category-based extraction with metadata for ${categoryCode}`);
          result = await backendApi.extractWithCategory({
            image: base64Image,
            categoryCode,
            vendorName: metadata.vendorName,
            designNumber: metadata.designNumber,
            pptNumber: metadata.pptNumber,
            costPrice: metadata.costPrice,
            sellingPrice: metadata.sellingPrice,
            notes: metadata.notes,
            discoveryMode: discoveryEnabled === true,
            fileName: row.originalFileName,
            folderName
          });
        } else {
          // Fall back to legacy extraction without metadata
          // Still pass department/subDepartment parsed from categoryCode so the backend
          // (a) finds the correct DB category and (b) can override flat fields after flattening.
          const legacyScope = parseSelectedScope(categoryCode, categoryName);
          console.log(`📦 Using legacy extraction without metadata`);
          result = await backendApi.extractFromBase64({
            image: base64Image,
            schema,
            categoryName: categoryName ?? "",
            discoveryMode: discoveryEnabled === true,
            fileName: row.originalFileName,
            folderName,
            ...(legacyScope.division    ? { department:     legacyScope.division    } : {}),
            ...(legacyScope.subDivision ? { subDepartment:  legacyScope.subDivision } : {}),
            ...(presentationsType       ? { presentationsType }                      : {}),
          });
        }

        const persistence = (result as any)?.persistence as { jobId?: string; flatId?: string | null } | undefined;

        const totalTime = performance.now() - start;

        // APPLY SMART ATTRIBUTE PROCESSING
        // Convert schema array to Record format for AttributeProcessor
        const schemaAsRecord = schema.reduce((acc, attr) => {
          acc[attr.key] = attr;
          return acc;
        }, {} as Record<string, SchemaItem>);

        const processedAttributesSync = AttributeProcessor.processBatchResults(
          result.attributes,
          schemaAsRecord
        );

        const selectedScope = parseSelectedScope(categoryCode, categoryName);
        if (selectedScope.division) {
          processedAttributesSync.division = buildScopeAttribute(
            selectedScope.division,
            'Auto-filled from selected extraction scope'
          );
        }
        if (selectedScope.subDivision) {
          processedAttributesSync.sub_division = buildScopeAttribute(
            selectedScope.subDivision,
            'Auto-filled from selected extraction scope'
          );
        }

        const updated: ExtractedRowEnhanced = {
          ...row,
          status: "Done",
          persistedJobId: persistence?.jobId,
          persistedFlatId: persistence?.flatId ?? null,
          reviewCompleted: false,
          attributes: processedAttributesSync,
          discoveries: result.discoveries ?? [],
          apiTokensUsed: result.tokensUsed,
          modelUsed: result.modelUsed,
          extractionTime: totalTime,
          confidence: result.confidence,
          updatedAt: new Date(),
          processingProgress: 100,
        };

        updateRows((prev) =>
          prev.map((r) => (r.id === row.id ? updated : r))
        );

        addNotification({
          title: "Extraction completed",
          description: `${row.originalFileName} completed with ${Math.round(result.confidence)}% confidence.`,
          type: "success",
        });

        const discoveries = result.discoveries ?? [];
        if (discoveries.length > 0) {
          discoveryManager.addDiscoveries(discoveries, categoryName ?? "");
          setGlobalDiscoveries(discoveryManager.getDiscoveriesForCategory());
        }

        recordPerf({
          compressionTime: 0,
          apiRequestTime: result.processingTime,
          parsingTime: 0,
          totalTime,
          memoryUsed: getMemoryUsage(),
        });

        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error('Extraction error details:', err);

        updateRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? {
                ...r,
                status: "Error",
                error: msg,
                updatedAt: new Date(),
                processingProgress: 0,
                retryCount: (r.retryCount || 0) + 1,
              }
              : r
          )
        );

        setExtractionErrors((prev) => [
          ...prev,
          {
            code: "EXTRACT_FAIL",
            message: msg,
            details: { fileName: row.originalFileName },
            retryable: true,
            timestamp: new Date(),
          },
        ]);

        const isUploadFailure =
          msg.toLowerCase().includes('upload') ||
          msg.toLowerCase().includes('cloud storage');

        if (isUploadFailure) {
          message.error(
            `Image Upload Failed — "${row.originalFileName}" could not be uploaded to cloud storage. The article was not created. Please check your connection and try again.`,
          );
        } else {
          message.error(`Extraction failed for ${row.originalFileName}: ${msg}`);
        }

        return row;
      }
    },
    [backendApi, discoverySettings.enabled, recordPerf, compress, updateRows]
  );

  const {
    extractAllPending,
    cancelExtraction,
    pauseExtraction,
    resumeExtraction,
    retryFailed,
    clearCompleted,
    isPaused,
    estimatedTimeRemaining,
    totalTokensUsed
  } = useBatchExtraction(
    extractedRows,
    updateRows,
    extractImageAttributes,
    updateProgress,
    updateIsExtracting,
    recordPerf,
    abortRef
  );

  // Add images ensuring no duplicates by name
  const addImages = useCallback(
    async (files: File[]) => {
      try {
        const rows = await Promise.all(files.map(newRow));
        updateRows((prev) => {
          const names = new Set(prev.map((r) => r.originalFileName));
          return [...prev, ...rows.filter((r) => !names.has(r.originalFileName))];
        });
        return rows;
      } catch (e: unknown) {
        message.error("Failed to add images.");
        return [];
      }
    },
    [newRow]
  );

  const removeRow = useCallback((id: string) => {
    updateRows((prev) => prev.filter((r) => r.id !== id));
  }, [updateRows]);

  const clearAll = useCallback(() => {
    console.log('🧹 Clearing all extractions and aborting ongoing processes...');

    // Abort all ongoing extractions
    if (abortRef.current) {
      abortRef.current.abort();
      console.log('🛑 Aborted current extraction controller');
    }

    // Clean up blob URLs
    extractedRows.forEach((r) => {
      if (r.imagePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(r.imagePreviewUrl);
      }
    });

    // Reset all state
    updateRows([]);
    discoveryManager.clear();
    setGlobalDiscoveries([]);
    setPerformanceMetrics([]);
    setExtractionErrors([]);
    updateProgress(0);
    updateIsExtracting(false);

    console.log('✅ All extractions cleared and state reset');
  }, [extractedRows]);

  // Promote discovery to schema with success/error message
  const promoteDiscoveryToSchema = useCallback((key: string) => {
    const p = discoveryManager.promoteToSchema(key);
    if (p) {
      setGlobalDiscoveries(discoveryManager.getDiscoveriesForCategory());
      message.success(`'${p.label}' added to schema`);
    } else {
      message.error("Promotion failed");
    }
  }, []);

  // Update attribute in specific row immutably
  const updateRowAttribute = useCallback(
    (rowId: string, attributeKey: string, value: string | number | null) => {
      let previousAttribute: any = null;
      let persistedJobId: string | undefined;

      updateRows((prev) =>
        prev.map((row) => {
          if (row.id === rowId) {
            const existingAttribute = row.attributes[attributeKey];
            previousAttribute = existingAttribute ?? null;
            persistedJobId = row.persistedJobId;
            const updatedAttribute = {
              rawValue: value !== null ? String(value) : null,
              schemaValue: value,
              visualConfidence: existingAttribute?.visualConfidence ?? 0,
              mappingConfidence: 100,
              isNewDiscovery: existingAttribute?.isNewDiscovery ?? false,
              reasoning: existingAttribute?.reasoning || "User edited",
              isUserEdited: true,
            };

            return {
              ...row,
              attributes: {
                ...row.attributes,
                [attributeKey]: updatedAttribute,
              },
              updatedAt: new Date(),
            };
          }
          return row;
        })
      );

      // Persist user edits once extraction row has been saved to backend.
      if (!persistedJobId) {
        message.warning('This field was updated locally but could not be saved — extraction has not been persisted yet. Please re-extract or refresh.');
        return;
      }

      const token = localStorage.getItem('authToken');
      fetch(`${APP_CONFIG.api.baseURL}/user/extraction/history/flat/job/${encodeURIComponent(persistedJobId)}/attribute`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          attributeKey,
          value
        })
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorPayload = await response.json().catch(() => null);
            throw new Error(errorPayload?.error || 'Failed to save changes');
          }
        })
        .catch((error) => {
          message.error(error instanceof Error ? error.message : 'Failed to save changes');
          // Revert UI if backend save fails
          updateRows((prev) =>
            prev.map((row) => {
              if (row.id !== rowId) return row;
              return {
                ...row,
                attributes: {
                  ...row.attributes,
                  [attributeKey]: previousAttribute
                },
                updatedAt: new Date()
              };
            })
          );
        });
    },
    [updateRows]
  );

  const markRowReviewCompleted = useCallback(
    (rowId: string, checked: boolean) => {
      const targetRow = extractedRows.find((row) => row.id === rowId);
      const eligible = !!targetRow && targetRow.status === 'Done' && !!targetRow.persistedJobId;

      if (checked && !eligible) {
        message.warning('This article can be marked done only after extraction is completed.');
        return;
      }

      let previousReviewed: boolean | undefined;
      let persistedJobId: string | undefined;

      updateRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row;
          previousReviewed = row.reviewCompleted;
          persistedJobId = row.persistedJobId;
          return {
            ...row,
            reviewCompleted: checked,
            updatedAt: new Date(),
          };
        })
      );

      if (!persistedJobId) {
        message.error('Cannot mark as done before extraction is saved.');
        updateRows((prev) =>
          prev.map((row) =>
            row.id === rowId
              ? { ...row, reviewCompleted: previousReviewed }
              : row
          )
        );
        return;
      }

      const token = localStorage.getItem('authToken');
      fetch(`${APP_CONFIG.api.baseURL}/user/extraction/history/flat/job/${encodeURIComponent(persistedJobId)}/review-complete`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ checked })
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorPayload = await response.json().catch(() => null);
            throw new Error(errorPayload?.error || 'Failed to mark as done');
          }
          message.success('Marked as checked. Item moved to Products and Approver queue.');
        })
        .catch((error) => {
          message.error(error instanceof Error ? error.message : 'Failed to mark as done');
          updateRows((prev) =>
            prev.map((row) =>
              row.id === rowId
                ? { ...row, reviewCompleted: previousReviewed }
                : row
            )
          );
        });
    },
    [extractedRows, updateRows]
  );

  const markRowsReviewCompleted = useCallback(
    async (rowIds: string[], checked: boolean) => {
      if (!Array.isArray(rowIds) || rowIds.length === 0) {
        return { successCount: 0, failureCount: 0, skippedCount: 0 };
      }

      const token = localStorage.getItem('authToken');

      const targetRows = extractedRows.filter((row) => rowIds.includes(row.id));
      const eligibleRows = targetRows.filter((row) =>
        row.status === 'Done' &&
        !!row.persistedJobId &&
        (checked ? !row.reviewCompleted : true)
      );
      const skippedCount = targetRows.length - eligibleRows.length;

      const previousReviewMap = new Map<string, boolean | undefined>();
      eligibleRows.forEach((row) => previousReviewMap.set(row.id, row.reviewCompleted));

      const eligibleIds = new Set(eligibleRows.map((row) => row.id));

      if (checked && eligibleRows.length === 0) {
        message.warning('No eligible rows to mark done. Complete extraction first.');
        return { successCount: 0, failureCount: 0, skippedCount: targetRows.length };
      }

      updateRows((prev) =>
        prev.map((row) =>
          eligibleIds.has(row.id)
            ? {
              ...row,
              reviewCompleted: checked,
              updatedAt: new Date()
            }
            : row
        )
      );

      let successCount = 0;
      let failureCount = 0;

      await Promise.all(
        eligibleRows.map(async (row) => {
          try {
            const response = await fetch(`${APP_CONFIG.api.baseURL}/user/extraction/history/flat/job/${encodeURIComponent(String(row.persistedJobId))}/review-complete`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
              },
              body: JSON.stringify({ checked })
            });

            if (!response.ok) {
              const errorPayload = await response.json().catch(() => null);
              throw new Error(errorPayload?.error || 'Failed to mark as done');
            }

            successCount += 1;
          } catch {
            failureCount += 1;
            updateRows((prev) =>
              prev.map((item) =>
                item.id === row.id
                  ? {
                    ...item,
                    reviewCompleted: previousReviewMap.get(row.id),
                    updatedAt: new Date()
                  }
                  : item
              )
            );
          }
        })
      );

      return { successCount, failureCount, skippedCount };
    },
    [extractedRows, updateRows]
  );

  // Extract statistics from current rows
  const stats = useMemo(() => {
    const done = extractedRows.filter((r) => r.status === "Done").length;
    return {
      total: extractedRows.length,
      pending: extractedRows.filter((r) => r.status === "Pending").length,
      extracting: extractedRows.filter((r) => r.status === "Extracting").length,
      done,
      error: extractedRows.filter((r) => r.status === "Error").length,
      successRate:
        extractedRows.length > 0
          ? Math.round((done / extractedRows.length) * 100)
          : 0,
      discoveries: discoveryManager.getDiscoveriesForCategory().length,
    };
  }, [extractedRows]);

  useEffect(() => {
    return () => {
      compressionService.destroy();
    };
  }, []); // Keep extraction running across navigation

  return {
    isExtracting,
    extractedRows,
    progress,
    addImages,
    extractImageAttributes,
    extractAllPending,
    cancelExtraction,
    pauseExtraction,
    resumeExtraction,
    retryFailed,
    clearCompleted,
    isPaused,
    estimatedTimeRemaining,
    totalTokensUsed,
    removeRow,
    clearAll,
    updateRowAttribute,
    markRowReviewCompleted,
    markRowsReviewCompleted,
    stats,
    performanceMetrics,
    extractionErrors,
    batchResults,
    discoverySettings,
    setDiscoverySettings,
    globalDiscoveries,
    promoteDiscoveryToSchema,
    getMemoryInfo,
    // Metadata support
    currentMetadata,
    setCurrentMetadata,
    currentCategoryCode,
    setCurrentCategoryCode,
  };
};
