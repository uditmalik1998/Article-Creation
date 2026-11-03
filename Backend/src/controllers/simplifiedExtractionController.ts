/**
 * Simplified Extraction Controller
 * 
 * This controller handles the simplified extraction workflow:
 * - Department → Major Category only (no sub-department)
 * - Fixed schema of 27 attributes
 * - No metadata input required
 * - Confidence threshold: 65-75% minimum
 * 
 * To preserve rollback capability, this runs alongside the existing
 * enhancedExtractionController without modifying it.
 */

import { Request, Response, NextFunction } from 'express';
import { vlmService } from '../services/vlm/vlmService';
import { ImageProcessor } from '../utils/imageProcessor';
import { getSimplifiedSchema, filterByConfidence, applyGarmentTypeRules } from '../config/simplifiedAttributes';
import { SimplifiedPromptService } from '../services/simplifiedPromptService';
import { getMcCodeByMajorCategory } from '../utils/mcCodeMapper';
import { hierarchyService } from '../services/hierarchyService';
import type { FashionExtractionRequest } from '../types/vlm';

interface BaseSchemaItem {
  key: string;
  label: string;
  type: any;
  required: boolean;
  confidenceThreshold?: number;
}

export class SimplifiedExtractionController {
  private vlmService = vlmService;
  private promptService = new SimplifiedPromptService();

  /**
   * Restrict an extraction schema to the per-major-category grid whitelist.
   *
   * STRICT scoping (per product requirement):
   *  - Only attributes that have grid values for this major category are kept.
   *  - Each kept attribute gets `allowedValues` = that category's grid values,
   *    so the VLM must pick the nearest of those values.
   *  - Attributes with NO grid value for this category are DROPPED entirely
   *    (no global-allowed-value fallback → nothing extracted/stored for them).
   */
  private applyGridConstraint(
    baseSchema: BaseSchemaItem[],
    gridValues: Map<string, string[]>
  ): Array<BaseSchemaItem & { allowedValues: string[] }> {
    return baseSchema
      .filter(a => gridValues.has(a.key) && gridValues.get(a.key)!.length > 0)
      .map(a => ({ ...a, allowedValues: gridValues.get(a.key)! }));
  }

  /**
   * Simplified extraction from uploaded image
   * Uses fixed 27-attribute schema, no metadata required
   */
  extractSimplified = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          error: 'No image file provided',
          timestamp: Date.now()
        });
        return;
      }

      // Validate the image file
      ImageProcessor.validateImageFile(req.file);

      // Parse request - only need department and majorCategory
      const { 
        department,
        majorCategory,
        categoryName
      } = req.body;

      const normalizedMajorCategory = String(majorCategory || '').trim();

      // Load category from DB (falls back to hardcoded if DB is empty)
      const dbCategory = await hierarchyService.getCategoryForExtraction(normalizedMajorCategory);
      if (!dbCategory && !getMcCodeByMajorCategory(normalizedMajorCategory)) {
        res.status(400).json({
          success: false,
          error: 'Invalid majorCategory. Category not found.',
          timestamp: Date.now()
        });
        return;
      }

      // Convert image to base64
      const base64Image = await ImageProcessor.processImageToBase64(req.file);

      // Per-major-category allowed values (strict whitelist, no global fallback).
      const gridValues = await hierarchyService.getCategoryGridValues(normalizedMajorCategory);

      // STRICT: a category with no grid values stores nothing during extraction.
      if (gridValues.size === 0) {
        console.log(`⏭️  No grid values for major category "${majorCategory}" — nothing extracted/stored.`);
        res.json({
          success: true,
          data: { attributes: {}, confidence: 0, processingTime: 0 },
          metadata: {
            simplifiedMode: true,
            dbDriven: !!dbCategory,
            gridConstrained: true,
            totalAttributes: 0,
            highConfidenceCount: 0,
            confidenceThreshold: 65,
            note: 'No grid values configured for this major category'
          },
          timestamp: Date.now()
        });
        return;
      }

      // Base schema (DB attributes if available, else hardcoded fallback),
      // then narrowed to the per-category grid whitelist.
      const baseSchema: BaseSchemaItem[] = dbCategory
        ? dbCategory.attributes.map(a => ({ key: a.key, label: a.label, type: a.type as any, required: false, confidenceThreshold: a.confidenceThreshold }))
        : getSimplifiedSchema().map(a => ({ key: a.key, label: a.label, type: a.type as any, required: false }));
      const schema = this.applyGridConstraint(baseSchema, gridValues);
      const attrCount = schema.length;

      console.log(`🚀 Simplified Extraction Started`);
      console.log(`   Department: ${department}`);
      console.log(`   Major Category: ${majorCategory}`);
      console.log(`   Attributes: ${attrCount} grid-constrained (${dbCategory ? 'DB-driven' : 'hardcoded fallback'})`);

      // No grid-constrained attributes intersect the schema → nothing to store.
      if (attrCount === 0) {
        console.log(`⏭️  Grid has values, but none match this category's schema — nothing stored.`);
        res.json({
          success: true,
          data: { attributes: {}, confidence: 0, processingTime: 0 },
          metadata: {
            simplifiedMode: true,
            dbDriven: !!dbCategory,
            gridConstrained: true,
            totalAttributes: 0,
            highConfidenceCount: 0,
            confidenceThreshold: 65
          },
          timestamp: Date.now()
        });
        return;
      }

      // Generate simplified prompt
      const customPrompt = this.promptService.generateSimplifiedPrompt(department, majorCategory);

      // Create VLM request with simplified prompt
      const vlmRequest: FashionExtractionRequest = {
        image: base64Image,
        schema,
        categoryName: categoryName || majorCategory,
        department,
        customPrompt, // Use our simplified prompt
        discoveryMode: false // No discovery in simplified mode
      };

      // Extract using VLM service
      const result = await this.vlmService.extractFashionAttributes(vlmRequest);

      const filteredAttributes = filterByConfidence(result.attributes);
      const garmentSafeAttributes = dbCategory
        ? applyGarmentTypeRules(filteredAttributes, undefined, dbCategory.garmentType as any)
        : applyGarmentTypeRules(filteredAttributes, majorCategory);

      console.log(`✅ Simplified Extraction Complete`);
      console.log(`   Confidence: ${result.confidence}%`);
      console.log(`   Time: ${result.processingTime}ms`);
      console.log(`   High-confidence attributes: ${Object.keys(garmentSafeAttributes).filter(k => garmentSafeAttributes[k] !== null).length}/${attrCount}`);

      res.json({
        success: true,
        data: {
          ...result,
          attributes: garmentSafeAttributes
        },
        metadata: {
          simplifiedMode: true,
          dbDriven: !!dbCategory,
          totalAttributes: attrCount,
          highConfidenceCount: Object.keys(garmentSafeAttributes).filter(k => garmentSafeAttributes[k] !== null).length,
          confidenceThreshold: 65
        },
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('❌ Simplified extraction failed:', error);
      next(error);
    }
  };

  extractSimplifiedBase64 = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { image, department, majorCategory, categoryName } = req.body;

      if (!image) {
        res.status(400).json({ success: false, error: 'Base64 image is required', timestamp: Date.now() });
        return;
      }

      const normalizedMajorCategory = String(majorCategory || '').trim();
      const dbCategory = await hierarchyService.getCategoryForExtraction(normalizedMajorCategory);
      if (!dbCategory && !getMcCodeByMajorCategory(normalizedMajorCategory)) {
        res.status(400).json({ success: false, error: 'Invalid majorCategory. Category not found.', timestamp: Date.now() });
        return;
      }

      // Per-major-category allowed values (strict whitelist, no global fallback).
      const gridValues = await hierarchyService.getCategoryGridValues(normalizedMajorCategory);

      // STRICT: a category with no grid values stores nothing during extraction.
      if (gridValues.size === 0) {
        console.log(`⏭️  No grid values for major category "${majorCategory}" — nothing extracted/stored.`);
        res.json({
          success: true,
          data: { attributes: {}, confidence: 0, processingTime: 0 },
          metadata: {
            simplifiedMode: true,
            dbDriven: !!dbCategory,
            gridConstrained: true,
            totalAttributes: 0,
            highConfidenceCount: 0,
            confidenceThreshold: 65,
            note: 'No grid values configured for this major category'
          },
          timestamp: Date.now()
        });
        return;
      }

      const baseSchema: BaseSchemaItem[] = dbCategory
        ? dbCategory.attributes.map(a => ({ key: a.key, label: a.label, type: a.type as any, required: false, confidenceThreshold: a.confidenceThreshold }))
        : getSimplifiedSchema().map(a => ({ key: a.key, label: a.label, type: a.type as any, required: false }));
      const schema = this.applyGridConstraint(baseSchema, gridValues);
      const attrCount = schema.length;
      console.log(`🚀 Simplified Base64 Extraction Started — ${department} / ${majorCategory} (${attrCount} grid-constrained attrs)`);

      if (attrCount === 0) {
        console.log(`⏭️  Grid has values, but none match this category's schema — nothing stored.`);
        res.json({
          success: true,
          data: { attributes: {}, confidence: 0, processingTime: 0 },
          metadata: {
            simplifiedMode: true,
            dbDriven: !!dbCategory,
            gridConstrained: true,
            totalAttributes: 0,
            highConfidenceCount: 0,
            confidenceThreshold: 65
          },
          timestamp: Date.now()
        });
        return;
      }

      // Generate simplified prompt
      const customPrompt = this.promptService.generateSimplifiedPrompt(department, majorCategory);

      // Create VLM request
      const vlmRequest: FashionExtractionRequest = {
        image,
        schema,
        categoryName: categoryName || majorCategory,
        department,
        customPrompt, // Use our simplified prompt
        discoveryMode: false
      };

      // Extract
      const result = await this.vlmService.extractFashionAttributes(vlmRequest);

      const filteredAttributes = filterByConfidence(result.attributes);
      const garmentSafeAttributes = dbCategory
        ? applyGarmentTypeRules(filteredAttributes, undefined, dbCategory.garmentType as any)
        : applyGarmentTypeRules(filteredAttributes, majorCategory);

      const highConf = Object.keys(garmentSafeAttributes).filter(k => garmentSafeAttributes[k] !== null).length;
      console.log(`✅ Simplified Base64 Extraction Complete - ${highConf}/${attrCount} high-confidence`);

      res.json({
        success: true,
        data: { ...result, attributes: garmentSafeAttributes },
        metadata: {
          simplifiedMode: true,
          dbDriven: !!dbCategory,
          totalAttributes: attrCount,
          highConfidenceCount: highConf,
          confidenceThreshold: 65
        },
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('❌ Simplified base64 extraction failed:', error);
      next(error);
    }
  };
}
