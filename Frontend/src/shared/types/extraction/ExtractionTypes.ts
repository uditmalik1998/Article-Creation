import type { BaseEntity, ExtractionStatus, ModelType } from '../core/CommonTypes';
import type { AttributeDefinition } from '../category/CategoryTypes';

// Existing interfaces as is..

export interface AttributeDetail {
  schemaValue: string | number | null;
  rawValue: string | null;
  isNewDiscovery: boolean;
  visualConfidence: number;
  mappingConfidence: number;
  reasoning?: string;
  isUserEdited?: boolean;
}

export interface AttributeData {
  [key: string]: AttributeDetail | null;
}

export interface ExtractedRow extends BaseEntity {
  file: File;
  originalFileName: string;
  imagePreviewUrl: string;
  status: ExtractionStatus;
  attributes: AttributeData;
  apiTokensUsed?: number;
  modelUsed?: ModelType;
  extractionTime?: number;
  error?: string;
  confidence?: number;
}

export interface ExtractedRowEnhanced extends ExtractedRow {
  discoveryMode: unknown;
  persistedJobId?: string;
  persistedFlatId?: string | null;
  reviewCompleted?: boolean;
  processingProgress?: number;
  queuePosition?: number;
  retryCount?: number;
  discoveries?: DiscoveredAttribute[];
  // New MVGR and Weave fields
  macroMvgr?: string;
  mainMvgr?: string;
  mFab2?: string;
}

export type SchemaItem = AttributeDefinition;

export interface ExtractionResult {
  attributes: AttributeData;
  tokensUsed: number;
  modelUsed: ModelType;
  processingTime: number;
  confidence: number;
}
export interface DiscoveryStats {
  totalFound: number;
  highConfidence: number;
  schemaPromotable: number;
  uniqueKeys: number;
}

export interface EnhancedExtractionResult extends ExtractionResult {
  discoveries?: DiscoveredAttribute[];
  discoveryStats?: DiscoveryStats;
  errorDetails?: {
    stage: 'compression' | 'api' | 'parsing';
    originalError: string;
    retryable: boolean;
    discoveryStats?: string | Record<string, unknown> | number;
  };
}


export interface VirtualScrollData {
  totalCount: number;
  visibleRange: { start: number; end: number };
  itemHeight: number;
  overscan: number;
}

export interface BulkExtractionOptions {
  batchSize: number;
  maxConcurrency: number;
  retryAttempts: number;
  progressCallback?: (progress: number, current: string) => void;
  errorCallback?: (error: string, fileName: string) => void;
}

export interface DiscoveredAttribute {
  key: string;
  label: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  reasoning: string;
  frequency: number;
  suggestedType: 'text' | 'select' | 'number';
  possibleValues?: string[];
  isPromotable?: boolean;
}

export interface DiscoverySettings {
  enabled: boolean;
  minConfidence: number;
  showInTable: boolean;
  autoPromote: boolean;
  maxDiscoveries: number;
}

export interface PerformanceMetrics {
  compressionTime: number;
  apiRequestTime: number;
  parsingTime: number;
  totalTime: number;
  memoryUsed?: number;
  cpuTime?: number;
}

export interface ExportProgress {
  stage: 'preparing' | 'processing' | 'generating' | 'complete';
  progress: number;
  currentItem?: string;
  estimatedTimeRemaining?: number;
}

export interface ExportOptions {
  format: 'xlsx' | 'csv' | 'json';
  includeMetadata: boolean;
  includeDiscoveries: boolean;
  filterByStatus?: ExtractionStatus[];
  customFields?: string[];
}

export interface ExtractionError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  timestamp: Date;
}

export interface BatchOperationResult {
  successful: number;
  failed: number;
  total: number;
  errors: Array<{
    fileName: string;
    error: string;
  }>;
  duration: number;
}

// Newly added types:

/**
 * Parsed AI attribute partially matching the raw AI response.
 */
export interface ParsedAIAttribute {
  rawValue: string | null;
  schemaValue: string | number | null;
  visualConfidence: number;
  reasoning?: string;
}

/**
 * Enhanced AI response with schemaAttributes and discoveries fields.
 */
export interface EnhancedAIResponse {
  schemaAttributes?: Record<string, ParsedAIAttribute>;
  discoveries?: Record<string, ParsedDiscoveryAttribute>;
  // additional optional fields as needed
}

/**
 * Parsed discovery attribute as returned from enhanced AI response.
 */
export interface ParsedDiscoveryAttribute {
  isPromotable: boolean | undefined;
  rawValue?: string;
  normalizedValue?: string;
  confidence?: number;
  reasoning?: string;
  suggestedType?: 'text' | 'select' | 'number';
  possibleValues?: (string | undefined)[];
  // other optional fields can be added if required
}


