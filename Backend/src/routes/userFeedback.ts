/**
 * User Feedback Routes
 * Store user corrections for AI learning (without updating model weights)
 */

import { Router, Request, Response } from 'express';

const router = Router();

/**
 * POST /api/user/feedback/correction
 * Store user correction for AI learning analysis
 */
router.post('/correction', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      imageId,
      attributeKey,
      aiPredicted,
      userCorrected,
      category,
      department
    } = req.body;

    // Validate required fields
    if (!attributeKey || !aiPredicted || !userCorrected) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: attributeKey, aiPredicted, userCorrected'
      });
      return;
    }

    // Store feedback in database (or JSON file for now)
    const feedback = {
      id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      imageId,
      attributeKey,
      aiPredicted,
      userCorrected,
      category,
      department,
      // Track which AI model made this prediction
      modelUsed: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      // This helps analyze which models need improvement
      isCorrection: true
    };

    console.log('📚 [User Feedback] Correction logged:', feedback);

    // TODO: Store in database table for analysis
    // For now, just log it (no model update)
    
    res.status(200).json({
      success: true,
      message: 'Feedback recorded for future analysis',
      feedbackId: feedback.id
    });

  } catch (error) {
    console.error('❌ Error storing feedback:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store feedback'
    });
  }
});

/**
 * GET /api/user/feedback/stats
 * Get correction statistics (admin only)
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Query database for correction statistics
    // Example stats: most corrected attributes, accuracy per attribute, etc.
    
    res.status(200).json({
      success: true,
      stats: {
        totalCorrections: 0,
        mostCorrectedAttributes: [],
        accuracyByAttribute: {}
      }
    });

  } catch (error) {
    console.error('❌ Error fetching feedback stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stats'
    });
  }
});

export default router;
