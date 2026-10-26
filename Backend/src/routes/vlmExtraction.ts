import { Router } from 'express';
import multer from 'multer';
// Rate limiting disabled - import removed
import { EnhancedExtractionController } from '../controllers/enhancedExtractionController';
import { validateRequest } from '../middleware/errorHandler';
import { requireAdmin } from '../middleware/auth';

const router = Router();
const enhancedController = new EnhancedExtractionController();

// Rate limiting disabled - no-op middleware
const vlmExtractionLimiter = (req: any, res: any, next: any) => next();

// Configure multer for enhanced file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '15728640'), // 15MB for higher quality images
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

// Enhanced VLM Extraction Routes

// VLM System Health Check (no rate limiting)
router.get('/vlm/health', enhancedController.vlmHealthCheck);

// Enhanced extraction from uploaded file (rate limited)
router.post('/vlm/extract/upload', 
  vlmExtractionLimiter,
  upload.single('image'), 
  validateRequest, 
  enhancedController.extractFromUploadVLM
);

// Enhanced extraction from base64 image (rate limited)
router.post('/vlm/extract/base64', 
  vlmExtractionLimiter,
  validateRequest, 
  enhancedController.extractFromBase64VLM
);

// Advanced VLM analysis with full pipeline (rate limited)
router.post('/vlm/extract/advanced', 
  vlmExtractionLimiter,
  validateRequest, 
  enhancedController.extractWithAdvancedVLM
);

// Configure VLM providers (admin only). The VLM service is shared app-wide, so a
// change here applies to every extraction.
router.post('/vlm/configure',
  requireAdmin,
  validateRequest,
  enhancedController.configureVLMProvider
);

// 📊 VLM System Information Routes

router.get('/vlm/info', (req, res) => {
  res.json({
    success: true,
    data: {
      version: '2.0.0-vlm',
      pipeline: 'multi-vlm',
      providers: [
        {
          id: 'google-gemini',
          name: 'Google Gemini Vision',
          strengths: ['fashion_classification', 'color_detection', 'ocr', 'attribute_extraction'],
          speed: 'fast',
          accuracy: 'very_high',
          status: 'active'
        },
        {
          id: 'claude-sonnet',
          name: 'Anthropic Claude',
          strengths: ['reasoning', 'text_extraction', 'fallback'],
          speed: 'fast',
          accuracy: 'very_high',
          status: 'fallback'
        },
        {
          id: 'openai-gpt4v',
          name: 'OpenAI GPT-4 Vision',
          strengths: ['general_reasoning', 'reliability'],
          speed: 'medium',
          accuracy: 'very_high',
          status: 'fallback'
        }
      ],
      features: [
        'Multi-model pipeline',
        'Fashion-specialized analysis',
        'Automatic fallback chains',
        'Confidence-based routing',
        'Discovery mode',
        'Local & cloud processing',
        'Real-time health monitoring'
      ],
      capabilities: {
        fashionCategories: '283+',
        attributeTypes: ['color', 'fabric', 'style', 'fit', 'pattern', 'hardware', 'brand'],
        imageFormats: ['JPEG', 'PNG', 'WebP', 'TIFF'],
        maxImageSize: '15MB',
        avgProcessingTime: '2-8 seconds',
        confidenceScoring: true,
        discoveryMode: true,
        batchProcessing: false
      }
    },
    timestamp: Date.now()
  });
});

// Fashion-Specific Routes

router.get('/vlm/fashion/categories', (req, res) => {
  res.json({
    success: true,
    data: {
      departments: [
        {
          id: 'mens',
          name: 'Mens',
          subDepartments: ['tops', 'bottoms', 'accessories', 'footwear', 'outerwear']
        },
        {
          id: 'ladies',
          name: 'Ladies', 
          subDepartments: ['tops', 'bottoms', 'dresses', 'accessories', 'footwear', 'outerwear']
        },
        {
          id: 'kids',
          name: 'Kids',
          subDepartments: ['tops', 'bottoms', 'accessories', 'footwear', 'outerwear']
        }
      ],
      seasons: ['spring', 'summer', 'fall', 'winter'],
      occasions: ['casual', 'formal', 'sport', 'party', 'work', 'travel'],
      supportedCategories: [
        'T-Shirt', 'Jeans', 'Dress', 'Blouse', 'Sweater', 'Jacket', 
        'Skirt', 'Shorts', 'Pants', 'Shoes', 'Bag', 'Hat'
      ]
    },
    timestamp: Date.now()
  });
});

export default router;