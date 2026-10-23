import { Router } from 'express';
import multer from 'multer';
// Rate limiting disabled - import removed
import { ExtractionController } from '../controllers/extractionController';
import { EnhancedExtractionController } from '../controllers/enhancedExtractionController';
import { validateRequest } from '../middleware/errorHandler';

const router = Router();
const extractionController = new ExtractionController();
const vlmController = new EnhancedExtractionController();

// Rate limiting for extraction endpoints disabled
// No-op middleware to replace extractionLimiter
const extractionLimiter = (req: any, res: any, next: any) => next();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '15728640'), // 15MB default (matches frontend)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

// Health check route (no rate limiting)
router.get('/health', extractionController.healthCheck);

// Extract attributes from uploaded file (Enhanced VLM Pipeline)
router.post('/extract/upload', 
  extractionLimiter,
  upload.single('image'), 
  validateRequest, 
  vlmController.extractFromUploadVLM
);

// Extract attributes from base64 image (Enhanced VLM Pipeline)
router.post('/extract/base64',
  extractionLimiter,
  validateRequest,
  vlmController.extractFromBase64VLM
);

// VLM Health Check Routes
router.get('/vlm/health', vlmController.vlmHealthCheck);

// Category-based extraction with database schema
router.post('/extract/category', 
  extractionLimiter,
  validateRequest, 
  vlmController.extractFromCategoryCode
);

export default router;