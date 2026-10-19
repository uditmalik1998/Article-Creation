/**
 * Cost Tracking Routes - Updated to use Flat Table
 * Endpoints for retrieving extraction costs from extraction_results_flat
 */

import { Router, Request, Response } from 'express';
import { prismaClient as prisma } from '../utils/prisma';

const router = Router();

/**
 * GET /api/user/costs/summary
 * Get cost summary from flat table
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const isAdmin = (req as any).user?.role === 'ADMIN';
    const where = isAdmin ? {} : { userId };

    // Aggregate in the database instead of fetching up to 5000 rows and summing
    // in JS. This is far cheaper on Disk IO (no row materialisation) AND fixes a
    // latent bug: the old 5000-row cap meant totals were under-counted once a
    // user had more than 5000 extractions.
    const agg = await prisma.extractionResultFlat.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        apiCost: true,
      },
    });

    const totalImages = agg._count._all;
    const totalInputTokens = agg._sum.inputTokens || 0;
    const totalOutputTokens = agg._sum.outputTokens || 0;
    const totalTokens = totalInputTokens + totalOutputTokens;
    const totalCost = Number(agg._sum.apiCost || 0);

    const summary = {
      totalImages,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCost,
      averageCostPerImage: totalImages > 0 ? totalCost / totalImages : 0,
      averageTokensPerImage: totalImages > 0 ? totalTokens / totalImages : 0,
      estimatedCreditsUsed: totalCost * 100 // Assuming 1 credit = $0.01
    };

    return res.json({
      success: true,
      data: summary
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/user/costs/images
 * Get all images with their costs from flat table
 */
router.get('/images', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const isAdmin = (req as any).user?.role === 'ADMIN';

    const flatResults = await prisma.extractionResultFlat.findMany({
      where: isAdmin ? {} : { userId },
      select: {
        jobId: true,
        imageName: true,
        imageUrl: true,
        inputTokens: true,
        outputTokens: true,
        apiCost: true,
        aiModel: true,
        processingTimeMs: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100 // Limit to last 100 for performance
    });

    const images = flatResults.map(r => ({
      imageId: r.jobId,
      imageName: r.imageName || 'Unknown',
      imageUrl: r.imageUrl,
      inputTokens: r.inputTokens || 0,
      outputTokens: r.outputTokens || 0,
      totalTokens: (r.inputTokens || 0) + (r.outputTokens || 0),
      cost: Number(r.apiCost || 0),
      modelName: r.aiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      extractionTimeMs: r.processingTimeMs || 0,
      timestamp: r.createdAt
    }));

    return res.json({
      success: true,
      data: images
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/user/costs/image/:imageId
 * Get specific image cost details
 */
router.get('/image/:imageId', async (req: Request, res: Response) => {
  try {
    const { imageId } = req.params;

    const flatResult = await prisma.extractionResultFlat.findUnique({
      where: { jobId: imageId }
    });

    if (!flatResult) {
      return res.status(404).json({
        success: false,
        error: 'Image not found'
      });
    }

    const imageData = {
      imageId: flatResult.jobId,
      imageName: flatResult.imageName,
      imageUrl: flatResult.imageUrl,
      inputTokens: flatResult.inputTokens || 0,
      outputTokens: flatResult.outputTokens || 0,
      totalTokens: (flatResult.inputTokens || 0) + (flatResult.outputTokens || 0),
      cost: Number(flatResult.apiCost || 0),
      modelName: flatResult.aiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      extractionTimeMs: flatResult.processingTimeMs || 0,
      timestamp: flatResult.createdAt
    };

    return res.json({
      success: true,
      data: imageData
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/user/costs/export
 * Export cost data as JSON
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const isAdmin = (req as any).user?.role === 'ADMIN';

    const flatResults = await prisma.extractionResultFlat.findMany({
      where: isAdmin ? {} : { userId },
      orderBy: { createdAt: 'desc' },
      take: 2000
    });

    const exportData = {
      exportDate: new Date().toISOString(),
      totalRecords: flatResults.length,
      totalCost: flatResults.reduce((sum, r) => sum + Number(r.apiCost || 0), 0),
      records: flatResults.map(r => ({
        imageName: r.imageName,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        apiCost: Number(r.apiCost),
        model: r.aiModel,
        processingTime: r.processingTimeMs,
        date: r.createdAt
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=cost-export-${new Date().toISOString().split('T')[0]}.json`);

    return res.send(JSON.stringify(exportData, null, 2));
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
