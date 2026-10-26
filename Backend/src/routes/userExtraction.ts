/**
 * 👤 User Extraction Routes
 * Authenticated endpoints for users to perform fashion extraction
 */

import { Router } from 'express';
import multer from 'multer';
// Rate limiting disabled - import removed
import { EnhancedExtractionController } from '../controllers/enhancedExtractionController';
import { flatExtractionController } from '../controllers/flatExtractionController';
import { validateRequest } from '../middleware/errorHandler';
import * as adminController from '../controllers/adminController';
import { prismaClient as prisma } from '../utils/prisma';
import { hierarchyService } from '../services/hierarchyService';

const router = Router();
const enhancedController = new EnhancedExtractionController();

// Rate limiting disabled - no-op middleware
const userExtractionLimiter = (req: any, res: any, next: any) => next();

// Configure multer for file uploads - using memory storage for R2
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '15728640'), // 15MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/tiff'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported: JPEG, PNG, WebP, TIFF'));
    }
  }
});

// ═══════════════════════════════════════════════════════
// HEALTH & STATUS
// ═══════════════════════════════════════════════════════
router.get('/health', enhancedController.vlmHealthCheck);

router.get('/vlm/info', (req, res) => {
  res.json({
    success: true,
    data: {
      version: '2.0.0-vlm',
      pipeline: 'multi-vlm',
      user: req.user ? {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role
      } : null,
      providers: [
        {
          id: 'openai-gpt4-vision',
          name: 'OpenAI GPT-4 Vision',
          strengths: ['comprehensive_analysis', 'high_accuracy', 'detailed_attributes'],
          speed: 'medium',
          accuracy: 'excellent'
        },
        {
          id: 'gemini-pro-vision',
          name: 'Google Gemini Pro Vision',
          strengths: ['fashion_understanding', 'color_accuracy', 'style_analysis'],
          speed: 'fast',
          accuracy: 'excellent'
        }
      ],
      features: {
        specializedPrompts: true,
        departmentBased: true,
        garmentTypeClassification: true,
        databaseDriven: true
      }
    },
    timestamp: new Date().toISOString()
  });
});

// ═══════════════════════════════════════════════════════
// EXTRACTION ENDPOINTS
// ═══════════════════════════════════════════════════════

// Extract from uploaded file (Primary method)
router.post('/extract/upload',
  userExtractionLimiter,
  upload.single('image'),
  validateRequest,
  enhancedController.extractFromUploadVLM
);

// Extract from base64 image (Primary method)
router.post('/extract/base64',
  userExtractionLimiter,
  validateRequest,
  enhancedController.extractFromBase64VLM
);

// Advanced VLM analysis
router.post('/extract/advanced',
  userExtractionLimiter,
  validateRequest,
  enhancedController.extractWithAdvancedVLM
);

// ═══════════════════════════════════════════════════════
// CATEGORY & SCHEMA INFORMATION
// ═══════════════════════════════════════════════════════

// Dynamic hierarchy for the extraction selector (dept → categories, DB-driven)
router.get('/hierarchy', async (req, res) => {
  try {
    const data = await hierarchyService.getSimpleHierarchy();
    res.json({ success: true, data, timestamp: Date.now() });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sub-divisions + major categories for ONE division, from major_category_details
// (active rows only) — feeds the FG extraction page's Sub-division / Major category dropdowns.
// GET /api/user/major-category-hierarchy?division=MENS
router.get('/major-category-hierarchy', async (req, res) => {
  try {
    const division = String(req.query.division || '').trim().toUpperCase();
    if (!division) return res.status(400).json({ success: false, error: 'division is required' });
    const rows = await prisma.majorCategoryDetails.findMany({
      where: { div: { equals: division, mode: 'insensitive' }, mcStatus: 'ACT' },
      select: { subDiv: true, majCat: true },
      orderBy: [{ subDiv: 'asc' }, { majCat: 'asc' }],
    });
    const majorCategories = rows
      .filter((r) => r.subDiv && r.majCat)
      .map((r) => ({ subDiv: r.subDiv!.trim(), majCat: r.majCat!.trim() }));
    const subDivisions = [...new Set(majorCategories.map((r) => r.subDiv))];
    return res.json({ success: true, data: { division, subDivisions, majorCategories } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Get all categories (read-only)
router.get('/categories', adminController.getAllCategories);

// ═══════════════════════════════════════════════════════
// HIERARCHY & DEPARTMENT INFORMATION (READ-ONLY)
// ═══════════════════════════════════════════════════════

// Get complete hierarchy tree
router.get('/hierarchy/tree', adminController.getHierarchyTree);

// Get all departments
router.get('/departments', adminController.getAllDepartments);

// Get extraction history from flat table (FAST - for product page)
router.get('/extraction/history/flat', flatExtractionController.getAllFlat);

// Save single attribute edit for an extracted row (by jobId)
router.put('/extraction/history/flat/job/:jobId/attribute', flatExtractionController.updateFlatAttributeByJobId);

// Get all sub-departments
router.get('/sub-departments', adminController.getAllSubDepartments);

// Get all master attributes
router.get('/attributes', adminController.getAllMasterAttributes);

// ═══════════════════════════════════════════════════════
// USER EXTRACTION HISTORY (NEW)
// ═══════════════════════════════════════════════════════

// Get user's extraction history
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const user = req.user!;
    const where: any = {};

    const parseSubDivisions = (value: unknown): string[] => {
      if (value === null || value === undefined) return [];
      const tokens = String(value)
        .split(/[;,|]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      return Array.from(new Set(tokens));
    };

    // RBAC Filtering Logic for Extraction Jobs
    const role = String(user.role || '');

    if (role === 'CREATOR' || role === 'PO_COMMITTEE') {
      where.userId = user.id;
    } else if (role === 'APPROVER') {
      const subDivisionList = parseSubDivisions(user.subDivision);
      // Approvers filter by category hierarchy
      where.category = {
        subDepartment: {
          code: subDivisionList.length > 1 ? { in: subDivisionList } : (subDivisionList[0] || undefined),
          department: {
            name: user.division || undefined
          }
        }
      };
    } else if (role === 'CATEGORY_HEAD') {
      // Category Heads see all records in their division
      where.category = {
        subDepartment: {
          department: {
            name: user.division || undefined
          }
        }
      };
    } else if (role === 'ADMIN') {
      // Admins see all
    }

    const [jobs, total] = await Promise.all([
      prisma.extractionJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
        include: {
          category: {
            select: {
              code: true,
              name: true,
              subDepartment: {
                select: {
                  name: true,
                  department: {
                    select: {
                      name: true
                    }
                  }
                }
              }
            }
          },
        }
      }),
      prisma.extractionJob.count({
        where
      })
    ]);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user's extraction statistics
router.get('/stats', async (req, res) => {
  try {
    const user = req.user!;
    const where: any = {};

    // RBAC Filtering Logic (same as /history)
    const role = String(user.role || '');

    if (role === 'CREATOR' || role === 'PO_COMMITTEE') {
      where.userId = user.id;
    } else if (role === 'APPROVER') {
      where.category = {
        subDepartment: {
          code: user.subDivision || undefined,
          department: {
            name: user.division || undefined
          }
        }
      };
    } else if (role === 'CATEGORY_HEAD') {
      where.category = {
        subDepartment: {
          department: {
            name: user.division || undefined
          }
        }
      };
    }

    const stats = await prisma.extractionJob.groupBy({
      by: ['status'],
      where,
      _count: { id: true }
    });

    const totalExtractions = stats.reduce((sum, s) => sum + s._count.id, 0);
    const completed = stats.find(s => s.status === 'COMPLETED')?._count.id || 0;
    const failed = stats.find(s => s.status === 'FAILED')?._count.id || 0;
    const pending = stats.find(s => s.status === 'PENDING')?._count.id || 0;
    const processing = stats.find(s => s.status === 'PROCESSING')?._count.id || 0;

    res.json({
      success: true,
      data: {
        totalExtractions,
        completed,
        failed,
        pending,
        processing,
        successRate: totalExtractions > 0 ? (completed / totalExtractions * 100).toFixed(2) : 0
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
