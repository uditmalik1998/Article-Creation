import { useCallback, useRef, useState } from 'react';
import { message } from '@/lib/message';
import type { ExtractedRowEnhanced, BatchOperationResult, SchemaItem, PerformanceMetrics } from '../../types/extraction/ExtractionTypes';

/**
 * Hook for batch extraction with pause/resume support.
 */
export const useBatchExtraction = (
  extractedRows: ExtractedRowEnhanced[],
  setExtractedRows: React.Dispatch<React.SetStateAction<ExtractedRowEnhanced[]>>,
  extractFunc: (
    row: ExtractedRowEnhanced,
    schema: SchemaItem[],
    cat?: string,
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
  ) => Promise<ExtractedRowEnhanced>,
  setProgress: (p: number) => void,
  setIsExtracting: (b: boolean) => void,
  _recordPerf: (metrics: PerformanceMetrics) => void,
  abortRef: React.MutableRefObject<AbortController | null>
) => {
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number>(0);
  const [totalTokensUsed, setTotalTokensUsed] = useState<number>(0);

  const extractAllPending = useCallback(async (
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
  ): Promise<BatchOperationResult | void> => {
    const pending = extractedRows.filter(row =>
      row.status === 'Pending' || (row.status === 'Error' && (row.retryCount || 0) < 3)
    );
    if (pending.length === 0) {
      message.info('No pending extractions.');
      return;
    }

    abortRef.current = new AbortController();
    setIsExtracting(true);
    setIsPaused(false);
    pauseRef.current = false;
    setProgress(0);
    setTotalTokensUsed(0);

    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    let totalTokens = 0;
    const tasks: Promise<void>[] = [];

    // Update queue positions
    pending.forEach((row, index) => {
      setExtractedRows(prev => prev.map(r => 
        r.id === row.id ? { ...r, queuePosition: index + 1, status: 'Queued' } : r
      ));
    });

    for (const row of pending) {
      // Check if paused
      while (pauseRef.current && !abortRef.current.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // concurrency limit = 5 (increased from 3 for better throughput)
      while (tasks.length >= 5) {
        await Promise.race(tasks);
      }
      if (abortRef.current.signal.aborted) break;

      // Update row status to Extracting
      setExtractedRows(prev => prev.map(r => 
        r.id === row.id ? { ...r, status: 'Extracting', processingProgress: 10 } : r
      ));

      const task = extractFunc(row, schema, categoryName, categoryCode, metadata, presentationsType)
        .then(updated => { 
          if (updated.status === 'Done') {
            successCount++;
            totalTokens += updated.apiTokensUsed || 0;
            setTotalTokensUsed(totalTokens);
          }
          
          // Update progress
          setExtractedRows(prev => prev.map(r => 
            r.id === updated.id ? { ...updated, processingProgress: 100 } : r
          ));
        })
        .catch(() => { 
          errorCount++;
          // Update to error state
          setExtractedRows(prev => prev.map(r => 
            r.id === row.id ? { ...r, status: 'Error', processingProgress: 100 } : r
          ));
        })
        .finally(() => {
          const completed = successCount + errorCount;
          const progressPercent = (completed / pending.length) * 100;
          setProgress(progressPercent);

          // Calculate estimated time remaining
          const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
          const avgTimePerItem = elapsedTime / completed;
          const remaining = pending.length - completed;
          setEstimatedTimeRemaining(avgTimePerItem * remaining);
        });

      tasks.push(task);
      task.finally(() => {
        const idx = tasks.indexOf(task);
        if (idx >= 0) tasks.splice(idx, 1);
      });
    }

    await Promise.allSettled(tasks);
    setIsExtracting(false);
    setIsPaused(false);
    pauseRef.current = false;
    setEstimatedTimeRemaining(0);

    const result: BatchOperationResult = {
      successful: successCount,
      failed: errorCount,
      total: pending.length,
      errors: [],
      duration: Date.now() - startTime
    };

    if (abortRef.current.signal.aborted) {
      message.info(`Batch stopped. ${successCount}/${pending.length} completed before stopping.`);
    } else {
      message.success(`Batch complete: ${successCount}/${pending.length} succeeded.`);
    }

    return result;
  }, [
    extractedRows,
    extractFunc,
    setProgress,
    setIsExtracting,
    abortRef,
    setExtractedRows
  ]);

  const pauseExtraction = useCallback(() => {
    pauseRef.current = true;
    setIsPaused(true);
    message.info('Batch processing paused.');
  }, []);

  const resumeExtraction = useCallback(() => {
    pauseRef.current = false;
    setIsPaused(false);
    message.info('Batch processing resumed.');
  }, []);

  const cancelExtraction = useCallback(() => {
    abortRef.current?.abort();
    setIsExtracting(false);
    setIsPaused(false);
    pauseRef.current = false;
    setProgress(0);
    setEstimatedTimeRemaining(0);
    message.info('Extraction cancelled.');
  }, [abortRef, setIsExtracting, setProgress]);

  const retryFailed = useCallback(() => {
    const failedRows = extractedRows.filter(row => row.status === 'Error');
    if (failedRows.length === 0) {
      message.info('No failed items to retry.');
      return;
    }
    
    // Reset failed rows to Pending
    setExtractedRows(prev => prev.map(row => 
      row.status === 'Error' 
        ? { ...row, status: 'Pending', error: undefined, retryCount: (row.retryCount || 0) + 1 }
        : row
    ));
    
    message.success(`${failedRows.length} items reset to pending for retry.`);
  }, [extractedRows, setExtractedRows]);

  const clearCompleted = useCallback(() => {
    const completedCount = extractedRows.filter(row => row.status === 'Done').length;
    if (completedCount === 0) {
      message.info('No completed items to clear.');
      return;
    }

    setExtractedRows(prev => prev.filter(row => row.status !== 'Done'));
    message.success(`${completedCount} completed items removed from queue.`);
  }, [extractedRows, setExtractedRows]);

  return { 
    extractAllPending, 
    cancelExtraction,
    pauseExtraction,
    resumeExtraction,
    retryFailed,
    clearCompleted,
    isPaused,
    estimatedTimeRemaining,
    totalTokensUsed
  };
};
