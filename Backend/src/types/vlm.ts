import { SchemaItem, AttributeData, EnhancedExtractionResult, DiscoveredAttribute, DiscoveryStats } from './extraction';
import { GarmentType } from '../generated/prisma';

// VLM Provider Interface
export interface VLMProvider {
  name: string;
  extractAttributes(request: FashionExtractionRequest): Promise<EnhancedExtractionResult>;
  isHealthy(): Promise<boolean>;
  configure?(config: VLMConfig): Promise<void>;
}

// VLM Configuration
export interface VLMConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

// Fashion Extraction Request
export interface FashionExtractionRequest {
  image: string; // base64 encoded
  schema: SchemaItem[];
  categoryName?: string;
  /** Selected major category code (shown in the prompt's category context). */
  majorCategory?: string;
  customPrompt?: string;
  discoveryMode?: boolean;
  mode?: 'fashion-focused' | 'detailed-analysis' | 'discovery-mode';
  existingAttributes?: AttributeData;
  
  // Fashion-specific parameters
  department?: 'mens' | 'ladies' | 'kids';
  garmentType?: GarmentType; // NEW: UPPER, LOWER, or ALL_IN_ONE for specialized prompts
  subDepartment?: 'tops' | 'bottoms' | 'accessories' | 'footwear';
  season?: 'spring' | 'summer' | 'fall' | 'winter';
  occasion?: 'casual' | 'formal' | 'sport' | 'party';
}

// VLM Result
export interface VLMResult extends EnhancedExtractionResult {
  providerId: string;
  providerName: string;
  confidence: number;
  processingTime: number;
  
  // Fashion-specific metadata
  fashionMetadata?: {
    categoryConfidence: number;
    brandDetected: boolean;
    fabricAnalysis: FabricAnalysis;
    colorProfile: ColorProfile;
    constructionDetails: ConstructionDetails;
  };
}

// Fashion-specific analysis results
export interface FabricAnalysis {
  material: string[];
  texture: string[];
  weight: 'lightweight' | 'medium' | 'heavy';
  stretch: boolean;
  transparency: 'opaque' | 'semi-transparent' | 'transparent';
  shine: 'matte' | 'satin' | 'glossy';
}

export interface ColorProfile {
  dominantColors: string[];
  accentColors: string[];
  colorScheme: 'monochromatic' | 'analogous' | 'complementary' | 'triadic';
  brightness: 'dark' | 'medium' | 'light';
  saturation: 'muted' | 'moderate' | 'vibrant';
}

export interface ConstructionDetails {
  seams: string[];
  hardware: string[];
  closures: string[];
  pockets: {
    type: string;
    count: number;
    placement: string[];
  };
  embellishments: string[];
}

// Provider-specific interfaces
export interface OpenAIVLMConfig extends VLMConfig {
  model: 'gpt-4o' | 'gpt-4-vision-preview';
  detail: 'low' | 'high' | 'auto';
}

export interface HuggingFaceVLMConfig extends VLMConfig {
  model: 'llava-hf/llava-1.5-7b-hf' | 'llava-hf/llava-1.5-13b-hf' | 'microsoft/kosmos-2-patch14-224';
}

export interface OllamaVLMConfig extends VLMConfig {
  model: 'llava:latest' | 'llava:7b' | 'llava:13b' | 'moondream:latest';
  baseUrl: string; // Ollama server URL
}

export interface FashionCLIPConfig extends VLMConfig {
  model: 'openai/clip-vit-base-patch32' | 'laion/CLIP-ViT-B-32-laion2B-s34B-b79K';
  fashionDatabase?: string; // Path to fashion embedding database
}

// Multi-VLM Pipeline Configuration
export interface VLMPipelineConfig {
  primaryProvider: string;
  fallbackChain: string[];
  confidenceThreshold: number;
  maxRetries: number;
  timeoutMs: number;
  
  // Fashion-specific settings
  fashionFocusEnabled: boolean;
  discoveryModeEnabled: boolean;
  brandDetectionEnabled: boolean;
  fabricAnalysisEnabled: boolean;
}

// Performance metrics
export interface VLMPerformanceMetrics {
  totalProcessingTime: number;
  providerBreakdown: Record<string, {
    time: number;
    success: boolean;
    tokensUsed: number;
    confidenceAchieved: number;
  }>;
  cacheHits: number;
  fallbacksUsed: number;
}

// Error types
export interface VLMError {
  code: 'PROVIDER_UNAVAILABLE' | 'LOW_CONFIDENCE' | 'TIMEOUT' | 'RATE_LIMIT' | 'INVALID_INPUT';
  message: string;
  providerId?: string;
  retryable: boolean;
  retryAfter?: number;
}

// Fashion Category Definitions for VLM
export interface FashionCategoryDefinition {
  name: string;
  department: string;
  subDepartment: string;
  coreAttributes: string[];
  optionalAttributes: string[];
  discoveryHints: string[];
  visualCues: string[];
  commonBrands: string[];
}

// VLM Response Cache
export interface VLMCacheEntry {
  imageHash: string;
  schema: SchemaItem[];
  result: EnhancedExtractionResult;
  timestamp: number;
  providerId: string;
  expiresAt: number;
}