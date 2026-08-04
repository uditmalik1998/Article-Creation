
import { SchemaItem, AttributeData, EnhancedExtractionResult } from '../../types/extraction';
import { OpenAIVLMProvider } from './providers/openaiProvider';
import { ClaudeVLMProvider } from './providers/claudeProvider';
import { GoogleVisionProvider } from './providers/googleVisionProvider';
// GoogleVisionProvider imported above for typed access to extractAllAttributes
// Disabled providers (deprecated endpoints or unavailable):
// import { HuggingFaceVLMProvider } from './providers/huggingfaceProvider';
// import { OllamaVLMProvider } from './providers/ollamaProvider';
// import { FashionCLIPProvider } from './providers/fashionClipProvider';

import { MultiModelFusionService } from './MultiModelFusionService';
import { FashionExtractionRequest, VLMProvider } from '@/types/vlm';

export class VLMService {
  private readonly providers: Map<string, VLMProvider> = new Map();
  private fallbackChain: string[] = [];
  private readonly fusionService: MultiModelFusionService;

  constructor() {
    this.initializeProviders();
    this.setupFallbackChain();
    this.fusionService = new MultiModelFusionService();
  }

  private initializeProviders(): void {
    this.providers.set('openai-gpt4v', new OpenAIVLMProvider());
    this.providers.set('claude-sonnet', new ClaudeVLMProvider());
    this.providers.set('google-gemini', new GoogleVisionProvider());
    // Disabled providers (deprecated endpoints or unavailable):
    // this.providers.set('huggingface-llava', new HuggingFaceVLMProvider());
    // this.providers.set('ollama-llava', new OllamaVLMProvider());
    // this.providers.set('fashion-clip', new FashionCLIPProvider());
  }

  private setupFallbackChain(): void {
    this.fallbackChain = [
      'google-gemini',
      'claude-sonnet',
      'openai-gpt4v'
    ];
  }

  /**
   * ENHANCED EXTRACTION with Multi-VLM Pipeline
   * Supports two modes:
   * 1. FALLBACK MODE (default): Use one model, fallback to others if it fails
   * 2. FUSION MODE: Use multiple models and combine their results
   */
  async extractFashionAttributes(
    request: FashionExtractionRequest,
    options?: {
      useFusion?: boolean;
      fusionMode?: 'voting' | 'confidence-weighted' | 'best-only';
      fusionModels?: string[];
    }
  ): Promise<EnhancedExtractionResult> {
    const startTime = Date.now();

    if (options?.useFusion) {
      return await this.extractWithMultiModelFusion(request, options);
    }

    try {
      // Stage 1: Detailed Analysis (Gemini extraction)
      const enhancedResult = await this.runDetailedAnalysis(request, { attributes: {}, confidence: 0, tokensUsed: 0 });

      // Stage 2: Discovery Mode (if enabled)
      const finalResult = request.discoveryMode
        ? await this.runDiscoveryAnalysis(request, enhancedResult)
        : enhancedResult;

      const processingTime = Date.now() - startTime;

      return {
        ...finalResult,
        processingTime,
        modelUsed: 'multi-vlm-pipeline' as any,
        tokensUsed: finalResult.tokensUsed || 0,
        inputTokens: finalResult.inputTokens || 0,
        outputTokens: finalResult.outputTokens || 0,
        apiCost: finalResult.apiCost || 0
      };

    } catch (error) {
      console.error('VLM extraction pipeline failed:', error);
      return await this.emergencyFallback(request);
    }
  }

  /**
   * Detailed Analysis — runs Gemini extraction for all schema attributes
   */
  private async runDetailedAnalysis(
    request: FashionExtractionRequest,
    fashionResult: Partial<EnhancedExtractionResult>
  ): Promise<EnhancedExtractionResult> {
    const startTime = Date.now();

    const missingAttributes = this.identifyMissingAttributes(request.schema, fashionResult.attributes || {});

    if (missingAttributes.length === 0) {
      return fashionResult as EnhancedExtractionResult;
    }

    let detailProvider: VLMProvider | undefined;
    let providerId = '';

    const providerPriority = ['google-gemini'];
    for (const pid of providerPriority) {
      const provider = this.providers.get(pid);
      if (!provider) continue;

      try {
        const healthy = await provider.isHealthy();
        if (healthy) {
          detailProvider = provider;
          providerId = pid;
          break;
        }
      } catch (error) {
        console.warn(`Health check failed for ${pid}:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }

    if (!detailProvider) {
      return fashionResult as EnhancedExtractionResult;
    }

    const detailResult = await detailProvider.extractAttributes({
      ...request,
      schema: missingAttributes,
      mode: 'detailed-analysis',
      existingAttributes: fashionResult.attributes
    });

    const mergedAttributes = {
      ...fashionResult.attributes,
      ...detailResult.attributes
    };

    return {
      attributes: mergedAttributes,
      confidence: this.calculateOverallConfidence(mergedAttributes),
      tokensUsed: (fashionResult.tokensUsed || 0) + (detailResult.tokensUsed || 0),
      inputTokens: (fashionResult.inputTokens || 0) + (detailResult.inputTokens || 0),
      outputTokens: (fashionResult.outputTokens || 0) + (detailResult.outputTokens || 0),
      apiCost: (fashionResult.apiCost || 0) + (detailResult.apiCost || 0),
      modelUsed: 'fashion-clip+llava' as any,
      processingTime: Date.now() - startTime,
      discoveries: [],
      discoveryStats: { totalFound: 0, highConfidence: 0, schemaPromotable: 0, uniqueKeys: 0 },
      rawGeminiResponse: detailResult.rawGeminiResponse ?? fashionResult.rawGeminiResponse ?? null,
    };
  }

  /**
   * Stage 3: Discovery Analysis (Optional)
   */
  private async runDiscoveryAnalysis(
    request: FashionExtractionRequest,
    baseResult: EnhancedExtractionResult
  ): Promise<EnhancedExtractionResult> {
    const discoveryProvider = this.providers.get('openai-gpt4v') || this.providers.get('huggingface-llava');
    if (!discoveryProvider) {
      return baseResult;
    }

    const discoveryResult = await discoveryProvider.extractAttributes({
      ...request,
      mode: 'discovery-mode',
      existingAttributes: baseResult.attributes
    });

    return {
      ...baseResult,
      discoveries: discoveryResult.discoveries || [],
      discoveryStats: discoveryResult.discoveryStats || baseResult.discoveryStats,
      tokensUsed: baseResult.tokensUsed + (discoveryResult.tokensUsed || 0)
    };
  }

  /**
   * Emergency Fallback — try each provider in fallback chain
   */
  private async emergencyFallback(
    request: FashionExtractionRequest
  ): Promise<EnhancedExtractionResult> {
    for (const providerId of this.fallbackChain) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      try {
        const result = await provider.extractAttributes(request);
        return result;
      } catch (error) {
        console.warn(`Fallback provider ${providerId} failed:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }

    console.error('All VLM providers failed during emergency fallback');
    throw new Error('All VLM providers failed');
  }

  /**
   * Helper Methods
   */
  private filterFashionCoreAttributes(schema: SchemaItem[]): SchemaItem[] {
    const fashionCoreKeys = [
      'color', 'fabric', 'pattern', 'style', 'fit', 'size', 'brand',
      'material', 'texture', 'neckline', 'sleeve', 'length', 'closure'
    ];

    return schema.filter(item =>
      fashionCoreKeys.some(key =>
        item.key.toLowerCase().includes(key.toLowerCase()) ||
        item.label.toLowerCase().includes(key.toLowerCase())
      )
    );
  }

  private identifyMissingAttributes(schema: SchemaItem[], attributes: AttributeData): SchemaItem[] {
    return schema.filter(item => {
      const attr = attributes[item.key];
      return !attr || attr.visualConfidence < 70;
    });
  }

  /**
   * MULTI-MODEL FUSION EXTRACTION
   * Use multiple AI models and combine their results for better accuracy
   */
  private async extractWithMultiModelFusion(
    request: FashionExtractionRequest,
    options: {
      useFusion?: boolean;
      fusionMode?: 'voting' | 'confidence-weighted' | 'best-only';
      fusionModels?: string[];
    }
  ): Promise<EnhancedExtractionResult> {
    const startTime = Date.now();

    const modelIds = options.fusionModels || ['openai-gpt4v', 'claude-sonnet', 'google-gemini'];
    const availableProviders: { id: string; provider: VLMProvider }[] = [];

    for (const id of modelIds) {
      const provider = this.providers.get(id);
      if (provider) {
        try {
          const isHealthy = await provider.isHealthy();
          if (isHealthy) {
            availableProviders.push({ id, provider });
          }
        } catch (error) {
          console.warn(`Health check failed for fusion provider ${id}`);
        }
      }
    }

    if (availableProviders.length === 0) {
      return await this.emergencyFallback(request);
    }

    if (availableProviders.length === 1) {
      const { id, provider } = availableProviders[0];
      const result = await provider.extractAttributes(request);
      return {
        ...result,
        processingTime: Date.now() - startTime,
        modelUsed: id as any
      };
    }

    const fusionMode = options.fusionMode || 'confidence-weighted';
    const fusedResult = await this.fusionService.extractWithFusion(
      availableProviders,
      request,
      fusionMode
    );

    return {
      ...fusedResult,
      processingTime: Date.now() - startTime
    };
  }

  private calculateOverallConfidence(attributes: AttributeData): number {
    const confidenceValues = Object.values(attributes)
      .filter(attr => attr !== null)
      .map(attr => attr.visualConfidence)
      .filter(conf => conf > 0);

    if (confidenceValues.length === 0) return 0;
    return Math.round(confidenceValues.reduce((sum, conf) => sum + conf, 0) / confidenceValues.length);
  }

  /**
   * Dedicated call for image_extraction_raw_data column.
   * Uses a free-form comprehensive prompt — separate from the structured 42-attribute flow.
   */
  async extractAllFashionAttributes(image: string): Promise<Record<string, any> | null> {
    const provider = this.providers.get('google-gemini') as GoogleVisionProvider | undefined;
    if (!provider) return null;
    try {
      return await provider.extractAllAttributes(image);
    } catch (err: any) {
      console.warn('[VLMService] extractAllFashionAttributes failed:', err?.message);
      return null;
    }
  }

  /**
   * Provider Health Check
   */
  async checkProviderHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [id, provider] of this.providers) {
      try {
        health[id] = await provider.isHealthy();
      } catch (error) {
        health[id] = false;
      }
    }

    return health;
  }

  /**
   * Dynamic Provider Configuration
   */
  async configureProvider(providerId: string, config: any): Promise<void> {
    const provider = this.providers.get(providerId);
    if (provider && 'configure' in provider) {
      await (provider as any).configure(config);
    }
  }
}
