import type { BaseEntity, ExtractionStatus, ModelType } from './common';

// Existing interfaces as is..

export interface AttributeDetail {
  schemaValue: string | number | null;
  rawValue: string | null;
  isNewDiscovery: boolean;
  visualConfidence: number;
  mappingConfidence: number;
  reasoning?: string;
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
  processingProgress?: number;
  queuePosition?: number;
  retryCount?: number;
  discoveries?: DiscoveredAttribute[];
}

export interface ExtractionResult {
  attributes: AttributeData;
  tokensUsed: number;
  modelUsed: ModelType;
  processingTime: number;
  confidence: number;
  inputTokens?: number;
  outputTokens?: number;
  apiCost?: number;
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
  extractedMetadata?: {
    vendorName?: string | null;
    designNumber?: string | null;
    price?: string | null;
    pptNumber?: string | null;
    majorCategory?: string | null;
    major_category?: string | null;
  };
  errorDetails?: {
    stage: 'compression' | 'api' | 'parsing';
    originalError: string;
    retryable: boolean;
    discoveryStats?: string | Record<string, unknown> | number;
  };
  rawGeminiResponse?: Record<string, any> | null;
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

// API Request/Response types
export interface ExtractionRequest {
  image: string; // base64 encoded image
  schema: SchemaItem[];
  categoryName?: string;
  customPrompt?: string;
  discoveryMode?: boolean;
  forceRefresh?: boolean; // Skip cache and force fresh extraction
}

export interface ExtractionResponse {
  success: boolean;
  data?: EnhancedExtractionResult;
  error?: string;
  timestamp: number;
}

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
}

// AllowedValue type (compatible with frontend)
export interface AllowedValue {
  shortForm: string;
  fullForm?: string;
}

// Schema item interface (supports both formats)
export interface SchemaItem {
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'boolean';
  required?: boolean;
  allowedValues?: (string | AllowedValue)[];
  description?: string;
}

// Request interface for API endpoints
export interface ExtractionRequest {
  image: string;
  schema: SchemaItem[];
  categoryName?: string;
  customPrompt?: string;
  discoveryMode?: boolean;
}