/**
 * Session Cost Tracker
 * Maintains per-session cost tracking for real-time updates
 * Only tracks costs from current session onwards (after reset)
 */

import { costCalculatorService, CostCalculation } from './costCalculator';

export interface ImageExtractionCost {
  imageId: string;
  imageName: string;
  imageUrl?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  model: string;
  extractedAt: string;
  extractionTimeMs?: number;
}

export interface SessionCostSummary {
  sessionId: string;
  userId?: number;
  totalImages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  averageCostPerImage: number;
  startedAt: string;
  lastUpdatedAt: string;
  images: ImageExtractionCost[];
}

class SessionCostTracker {
  private sessions: Map<string, SessionCostSummary> = new Map();
  private currentSessionId: string = `session_${Date.now()}`;

  constructor() {
    this.initializeSession(this.currentSessionId);
  }

  /**
   * Initialize a new tracking session
   */
  private initializeSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      totalImages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      averageCostPerImage: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      images: []
    });
  }

  /**
   * Set user ID for current session
   */
  setUserId(userId: number): void {
    const session = this.sessions.get(this.currentSessionId);
    if (session) {
      session.userId = userId;
    }
  }

  /**
   * Add a new image extraction cost to current session
   */
  addImageCost(
    imageId: string,
    imageName: string,
    inputTokens: number,
    outputTokens: number,
    model: string = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    imageUrl?: string,
    extractionTimeMs?: number
  ): ImageExtractionCost {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      throw new Error('No active session');
    }

    // Calculate cost for this image
    const costCalc = costCalculatorService.calculateCost(inputTokens, outputTokens, model);

    // Create image cost record
    const imageCost: ImageExtractionCost = {
      imageId,
      imageName,
      imageUrl,
      inputTokens: costCalc.inputTokens,
      outputTokens: costCalc.outputTokens,
      totalTokens: costCalc.totalTokens,
      cost: costCalc.totalCost,
      model,
      extractedAt: new Date().toISOString(),
      extractionTimeMs
    };

    // Add to session
    session.images.push(imageCost);
    session.totalImages += 1;
    session.totalInputTokens += costCalc.inputTokens;
    session.totalOutputTokens += costCalc.outputTokens;
    session.totalTokens += costCalc.totalTokens;
    session.totalCost += costCalc.totalCost;
    session.averageCostPerImage = session.totalCost / session.totalImages;
    session.lastUpdatedAt = new Date().toISOString();

    // Round to 6 decimal places
    session.totalCost = parseFloat(session.totalCost.toFixed(6));
    session.averageCostPerImage = parseFloat(session.averageCostPerImage.toFixed(6));

    return imageCost;
  }

  /**
   * Get current session summary
   */
  getCurrentSession(): SessionCostSummary {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      throw new Error('No active session');
    }
    return JSON.parse(JSON.stringify(session)); // Deep copy
  }

  /**
   * Get all images in current session
   */
  getImages(): ImageExtractionCost[] {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      return [];
    }
    return JSON.parse(JSON.stringify(session.images)); // Deep copy
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      return 0;
    }
    return session.totalCost;
  }

  /**
   * Get total images
   */
  getTotalImages(): number {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      return 0;
    }
    return session.totalImages;
  }

  /**
   * Get image by ID
   */
  getImageById(imageId: string): ImageExtractionCost | undefined {
    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      return undefined;
    }
    return session.images.find(img => img.imageId === imageId);
  }

  /**
   * Reset current session (clear all data)
   */
  resetCurrentSession(): void {
    this.sessions.delete(this.currentSessionId);
    this.currentSessionId = `session_${Date.now()}`;
    this.initializeSession(this.currentSessionId);
  }

  /**
   * Get session summary by ID
   */
  getSessionById(sessionId: string): SessionCostSummary | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(session)); // Deep copy
  }

  /**
   * Create a new session and return its ID
   */
  createNewSession(): string {
    const newSessionId = `session_${Date.now()}`;
    this.initializeSession(newSessionId);
    this.currentSessionId = newSessionId;
    return newSessionId;
  }

  /**
   * Export session data as JSON
   */
  exportSessionAsJSON(): string {
    const session = this.getCurrentSession();
    return JSON.stringify(session, null, 2);
  }

  /**
   * Get cost summary formatted for display
   */
  getCostSummaryForDisplay() {
    const session = this.getCurrentSession();
    return {
      totalCost: `$${session.totalCost.toFixed(6)}`,
      totalImages: session.totalImages,
      averageCostPerImage: `$${session.averageCostPerImage.toFixed(6)}`,
      totalTokens: `${(session.totalTokens / 1000).toFixed(2)}K`,
      totalInputTokens: `${(session.totalInputTokens / 1000).toFixed(2)}K`,
      totalOutputTokens: `${(session.totalOutputTokens / 1000).toFixed(2)}K`
    };
  }
}

// Singleton instance
export const sessionCostTracker = new SessionCostTracker();

export default SessionCostTracker;
