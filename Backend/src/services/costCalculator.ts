/**
 * Cost Calculator Service
 * Calculates API costs based on official Gemini pricing (May 2026)
 * Source: https://ai.google.dev/pricing
 * Primary model: gemini-2.5-pro — $1.25 input / $10.00 output per 1M tokens (≤200K context)
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostCalculation {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  model: string;
  timestamp: string;
}

// Gemini API Pricing (in USD per 1M tokens) — May 2026
// Source: https://ai.google.dev/pricing
const PRICING = {
  // $1.25 input / $10.00 output (standard ≤200K context tier)
  'gemini-2.5-pro': {
    inputPrice: 1.25,
    outputPrice: 10.00,
    displayName: 'Gemini 2.5 Pro'
  },
  // $0.15 input / $3.50 output (non-thinking)
  'gemini-2.5-flash': {
    inputPrice: 0.15,
    outputPrice: 3.50,
    displayName: 'Gemini 2.5 Flash'
  },
  // $0.10 input / $0.40 output
  'gemini-2.0-flash': {
    inputPrice: 0.10,
    outputPrice: 0.40,
    displayName: 'Gemini 2.0 Flash'
  },
  'gemini-2.0-flash-batch': {
    inputPrice: 0.05,
    outputPrice: 0.20,
    displayName: 'Gemini 2.0 Flash (Batch)'
  },
  // $1.25 input / $5.00 output (≤128K ctx)
  'gemini-1.5-pro': {
    inputPrice: 1.25,
    outputPrice: 5.00,
    displayName: 'Gemini 1.5 Pro'
  },
  // $0.075 input / $0.30 output (≤128K ctx)
  'gemini-1.5-flash': {
    inputPrice: 0.075,
    outputPrice: 0.30,
    displayName: 'Gemini 1.5 Flash'
  }
};

/**
 * Calculate cost for a single extraction based on token usage
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
): CostCalculation {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['gemini-2.5-pro'];
  
  // Convert pricing from per 1M tokens to per token
  const inputPricePerToken = pricing.inputPrice / 1_000_000;
  const outputPricePerToken = pricing.outputPrice / 1_000_000;
  
  // Calculate costs
  const inputCost = inputTokens * inputPricePerToken;
  const outputCost = outputTokens * outputPricePerToken;
  const totalCost = inputCost + outputCost;
  
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCost: parseFloat(inputCost.toFixed(6)),
    outputCost: parseFloat(outputCost.toFixed(6)),
    totalCost: parseFloat(totalCost.toFixed(6)),
    model,
    timestamp: new Date().toISOString()
  };
}

/**
 * Calculate cumulative cost from multiple extractions
 */
export function calculateCumulativeCost(
  extractions: Array<{ inputTokens: number; outputTokens: number; model?: string }>
): {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  extractionCount: number;
  averageCostPerImage: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  
  for (const extraction of extractions) {
    const model = extraction.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const calculation = calculateCost(extraction.inputTokens, extraction.outputTokens, model);
    
    totalInputTokens += calculation.inputTokens;
    totalOutputTokens += calculation.outputTokens;
    totalCost += calculation.totalCost;
  }
  
  return {
    totalInputTokens,
    totalOutputTokens,
    totalCost: parseFloat(totalCost.toFixed(6)),
    extractionCount: extractions.length,
    averageCostPerImage: parseFloat((totalCost / extractions.length).toFixed(6))
  };
}

/**
 * Format cost for display
 */
export function formatCost(cost: number, currency: string = 'USD'): string {
  if (currency === 'USD' || currency === '$') {
    return `$${cost.toFixed(6)}`;
  }
  return `${currency} ${cost.toFixed(6)}`;
}

/**
 * Format tokens for display (with K/M suffix)
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(2)}K`;
  }
  return tokens.toString();
}

/**
 * Get pricing information for a model
 */
export function getPricingInfo(model: string) {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['gemini-2.0-flash'];
  return {
    model,
    displayName: pricing.displayName,
    inputPrice: `$${pricing.inputPrice} per 1M tokens`,
    outputPrice: `$${pricing.outputPrice} per 1M tokens`,
    estimatedCostPerImage: `Varies by content`
  };
}

/**
 * Extract token info from Gemini API response
 */
export function extractTokensFromResponse(response: any): TokenUsage {
  // Handle different response formats from Gemini API
  if (response?.usageMetadata) {
    return {
      inputTokens: response.usageMetadata.promptTokenCount || 0,
      outputTokens: response.usageMetadata.candidatesTokenCount || response.usageMetadata.completionTokenCount || 0
    };
  }
  
  // Fallback for different API versions
  if (response?.usage) {
    return {
      inputTokens: response.usage.prompt_tokens || response.usage.input_tokens || 0,
      outputTokens: response.usage.completion_tokens || response.usage.output_tokens || 0
    };
  }
  
  return {
    inputTokens: 0,
    outputTokens: 0
  };
}

export const costCalculatorService = {
  calculateCost,
  calculateCumulativeCost,
  formatCost,
  formatTokens,
  getPricingInfo,
  extractTokensFromResponse
};
