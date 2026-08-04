import { Request, Response, NextFunction } from 'express';
import { VLMService } from '../services/vlm/vlmService';
import { ImageProcessor } from '../utils/imageProcessor';
import { cacheService } from '../services/cacheService';
import { SchemaService } from '../services/schemaService';
import { prismaClient as prisma } from '../utils/prisma';
import fs from 'fs';
import path from 'path';
import type { SchemaItem, ExtractionRequest, EnhancedExtractionResult } from '../types/extraction';
import type { FashionExtractionRequest } from '../types/vlm';
import { storageService } from '../services/storageService';
import { getHsnCodeByMcCode } from '../utils/mcCodeMapper';
import { getSegmentByCategoryAndMrp } from '../utils/segmentRangeMapper';
import { buildArticleDescription } from '../utils/articleDescriptionBuilder';
import { getExcludedDescriptionFields } from '../utils/categoryFieldVisibility';
import { duplicateForKidsDivision } from '../services/kidsDivisionDuplicationService';
import { createVariantsForGeneric } from '../services/variantCreationService';
import { mirror360FlatUpdate } from '../utils/mirror360Flat';
import { hierarchyService } from '../services/hierarchyService';
import { snapValueToGrid } from '../utils/gridSnap';

export class EnhancedExtractionController {
  private vlmService = new VLMService();
  private schemaService = new SchemaService();

  private async persistExtractionJob(params: {
    image: string | null;
    schema: SchemaItem[];
    categoryName?: string;
    resolvedCategoryCode?: string;
    userId?: number;
    result: EnhancedExtractionResult;
    originalFilename?: string;
    folderName?: string;
    department?: string;
    subDepartment?: string;
    presentationsType?: string;
    watcherFields?: {
      division?: string;
      vendorName?: string;
      vendorCode?: string;
      majorCategory?: string;
      subDivision?: string;
      mcCode?: string;
      source?: string;
      imageUncPath?: string;
    };
  }): Promise<{ jobId: string; flatId: string | null } | null> {
    try {
      const normalizeToken = (value?: string) =>
        String(value || '')
          .toLowerCase()
          .replace(/_/g, ' ')
          .replace(/\//g, ' ')
          .replace(/-/g, ' ')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const expandTokens = (token: string) => {
        const tokens = new Set<string>([token]);
        if (token.includes('colour')) tokens.add(token.replace(/colour/g, 'color'));
        if (token.includes('color')) tokens.add(token.replace(/color/g, 'colour'));
        return Array.from(tokens);
      };

      const { image, schema, categoryName, resolvedCategoryCode, userId, result, originalFilename, folderName, department, subDepartment, presentationsType } = params;

      const extractVendorCodeFromMetadata = (metadata: any): string | null => {
        if (!metadata || typeof metadata !== 'object') return null;

        const pick = (...keys: string[]) => {
          for (const key of keys) {
            const value = metadata[key];
            if (value !== null && value !== undefined && String(value).trim() !== '') {
              return String(value).trim();
            }
          }
          return null;
        };

        const directValue = pick('vendorCode', 'vendor_code', 'vendor code', 'vendorcode');
        if (directValue) return directValue;

        const rawLines: string[] = Array.isArray(metadata.rawLines)
          ? metadata.rawLines.map((line: any) => String(line || '')).filter(Boolean)
          : [];

        const labeledLine = rawLines.find((line: string) => /vendor\s*code|vendor\s*id|vendor\s*#|vendor\b/i.test(line));
        if (labeledLine) {
          const matched = labeledLine.match(/vendor(?:\s*code|\s*id|\s*#)?\s*[:\-]?\s*([A-Za-z0-9._\/-]+)/i);
          if (matched?.[1]) return matched[1].trim();
        }

        return null;
      };

      const sanitizeVendorCode = (value?: string | null): string | null => {
        if (!value) return null;
        const cleaned = String(value)
          .trim()
          .replace(/^['"`]+|['"`]+$/g, '')
          .replace(/[^A-Za-z0-9._\/-]/g, '')
          .slice(0, 100);
        return cleaned || null;
      };

      // Priority: folder name > OCR whiteboard metadata > manual approver entry (left blank initially)
      const folderVendorCode = sanitizeVendorCode(folderName);
      const ocrVendorCode = sanitizeVendorCode(extractVendorCodeFromMetadata(result.extractedMetadata as any));
      const resolvedVendorCode = folderVendorCode || ocrVendorCode || null;

      // Extract potential code from composite name (e.g. "Mens - ML" -> "ML" or "Mens-ML" -> "ML")
      let potentialCode = categoryName;

      if (categoryName) {
        if (categoryName.includes(' - ')) {
          const parts = categoryName.split(' - ');
          if (parts.length >= 2) potentialCode = parts[parts.length - 1].trim();
        } else if (categoryName.includes('-')) {
          const parts = categoryName.split('-');
          if (parts.length >= 2) potentialCode = parts[parts.length - 1].trim();
        }
      }

      const categoryFilters: any[] = [
        { name: { contains: categoryName, mode: 'insensitive' } },
        { fullForm: { contains: categoryName, mode: 'insensitive' } },
        { code: { equals: categoryName, mode: 'insensitive' } },
        { code: { equals: potentialCode, mode: 'insensitive' } } // Try matching extracted code
      ];

      // Build WHERE clause
      const whereClause: any = { OR: categoryFilters };

      // Enforce hierarchy constraints if provided (RBAC)
      if (department || subDepartment) {
        whereClause.subDepartment = {};

        if (department) {
          whereClause.subDepartment.department = {
            name: { equals: department, mode: 'insensitive' }
          };
        }

        if (subDepartment) {
          whereClause.subDepartment.code = { equals: subDepartment, mode: 'insensitive' };
        }
      }

      // If watcher already resolved the exact category code, use it directly
      let category = resolvedCategoryCode
        ? await prisma.category.findUnique({
          where: { code: resolvedCategoryCode },
          select: { id: true }
        })
        : categoryName
          ? await prisma.category.findFirst({
            where: whereClause,
            select: { id: true }
          })
          : null;

      // If no category found, check if it's a SubDepartment code (e.g. "ML")
      // and pick the first category under it as a proxy
      if (!category && potentialCode) {
        const subDept = await prisma.subDepartment.findFirst({
          where: { code: { equals: potentialCode, mode: 'insensitive' } },
          include: { categories: { take: 1, select: { id: true } } }
        });

        if (subDept && subDept.categories.length > 0) {
          category = subDept.categories[0];
        }
      }

      // Final fallback — prefer the correct division if watcher provided one
      if (!category) {
        const divisionHint = department || params.watcherFields?.division;
        category = await prisma.category.findFirst({
          where: divisionHint ? {
            subDepartment: { department: { name: { equals: divisionHint, mode: 'insensitive' } } }
          } : {},
          select: { id: true }
        });
        // Absolute last resort
        if (!category) {
          category = await prisma.category.findFirst({ select: { id: true } });
        }
      }

      const fallbackCategory = category;

      if (!fallbackCategory) return null;

      const attributes = await prisma.masterAttribute.findMany({
        select: { id: true, key: true, label: true }
      });
      const attributeIdByKey = new Map<string, number>();
      attributes.forEach((attr) => {
        const keyToken = normalizeToken(attr.key);
        const labelToken = normalizeToken(attr.label || '');
        if (keyToken) {
          expandTokens(keyToken).forEach(t => attributeIdByKey.set(t, attr.id));
        }
        if (labelToken) {
          expandTokens(labelToken).forEach(t => attributeIdByKey.set(t, attr.id));
        }
      });

      // STRICT per-major-category grid enforcement (garment attributes only).
      //
      // On the main extraction page the major category is NOT chosen up front —
      // the VLM/OCR classifies it during extraction — so we cannot pre-constrain
      // the schema like the auto-pipeline does. Instead we enforce the grid
      // whitelist here, after extraction, once the major category is known:
      //   • GRID-GOVERNED garment attributes (master_attributes.grid_attribute_name
      //     is set) are snapped to the nearest grid value; if this category has no
      //     grid values for that attribute (or no grid resolves at all) the value
      //     is dropped (strict whitelist).
      //   • Metadata/identity attributes (major_category, vendor_name/code,
      //     design_number, rate, mrp, size, division, gsm, weight, …) are NOT
      //     grid-governed and pass through unchanged so the article stays usable.
      //
      // The major category is read from extracted metadata first, then from the
      // extracted `major_category` attribute (the OCR'd whiteboard code, e.g.
      // "MW_TEES_FS"), so the grid resolves on the normal extraction path.
      const majorFromAttrs = (() => {
        const a = (result.attributes as any)?.major_category
          ?? (result.attributes as any)?.majorCategory
          ?? null;
        const v = a ? (a.schemaValue ?? a.rawValue ?? null) : null;
        return v != null && String(v).trim() !== '' ? String(v).trim() : null;
      })();
      const majorMetaValue = (result.extractedMetadata as any)?.majorCategory
        ?? (result.extractedMetadata as any)?.major_category
        ?? majorFromAttrs
        ?? null;
      const gridValues = majorMetaValue
        ? await hierarchyService.getCategoryGridValues(String(majorMetaValue).trim())
        : new Map<string, string[]>();
      const gridGovernedKeys = await hierarchyService.getGridGovernedKeys();
      const keyByAttributeId = new Map<number, string>(
        attributes.map(a => [a.id, a.key] as [number, string])
      );
      const gridReady = gridValues.size > 0;
      if (!gridReady) {
        console.log(`[Enhanced] No grid values for major category "${majorMetaValue ?? '(none)'}" — grid-governed garment attributes not stored (strict).`);
      }

      const attributeEntries = Object.entries(result.attributes || {})
        .filter(([_, v]) => {
          const value = v as any;
          return value && (value.schemaValue ?? value.rawValue) !== null;
        })
        .map(([key, v]: [string, any]) => {
          const token = normalizeToken(key);
          const attributeId = attributeIdByKey.get(token);
          if (!attributeId) return null;

          const masterKey = keyByAttributeId.get(attributeId);
          const isGridGoverned = masterKey ? gridGovernedKeys.has(masterKey) : false;

          if (isGridGoverned) {
            // STRICT grid scoping: drop the garment attribute when no grid is
            // resolvable, or this attribute has no grid values for the category.
            const allowed = (gridReady && masterKey) ? gridValues.get(masterKey) : undefined;
            if (!allowed || allowed.length === 0) return null;

            const extracted = v.schemaValue ?? v.rawValue ?? null;
            // Snap to the nearest grid value; null when there is no reasonable match.
            const snapped = extracted != null ? snapValueToGrid(String(extracted), allowed) : null;
            // Keep rawValue aligned with finalValue so the downstream flattener
            // (which falls back to rawValue when finalValue is null) cannot
            // resurrect an off-grid value.
            return {
              attributeId,
              rawValue: snapped,
              finalValue: snapped,
              confidence: v.visualConfidence ?? null,
              extractionMethod: 'VLM',
            };
          }

          // Non-grid metadata/identity attribute: store as extracted.
          const schemaValue = v.schemaValue ?? v.rawValue ?? null;
          const finalValue = schemaValue !== null && schemaValue !== undefined ? String(schemaValue) : null;
          return {
            attributeId,
            rawValue: v.rawValue ? String(v.rawValue) : null,
            finalValue,
            confidence: v.visualConfidence ?? null,
            extractionMethod: 'VLM',
          };
        })
        .filter(Boolean) as Array<{ attributeId: number; rawValue: string | null; finalValue: string | null; confidence: number | null; extractionMethod: string; }>;

      if (majorMetaValue) {
        const majorToken = normalizeToken('major_category');
        const majorAltToken = normalizeToken('major category');
        const majorAttributeId = attributeIdByKey.get(majorToken) || attributeIdByKey.get(majorAltToken);
        const hasMajor = attributeEntries.some(entry => entry.attributeId === majorAttributeId);
        if (majorAttributeId && !hasMajor) {
          attributeEntries.push({
            attributeId: majorAttributeId,
            rawValue: String(majorMetaValue),
            finalValue: String(majorMetaValue),
            confidence: 95,
            extractionMethod: 'VLM'
          });
        }
      }

      if (resolvedVendorCode) {
        const vendorCodeToken = normalizeToken('vendor_code');
        const vendorCodeAltToken = normalizeToken('vendor code');
        const vendorCodeAttributeId = attributeIdByKey.get(vendorCodeToken)
          || attributeIdByKey.get(vendorCodeAltToken);

        if (vendorCodeAttributeId) {
          const existingEntry = attributeEntries.find(entry => entry.attributeId === vendorCodeAttributeId);
          if (existingEntry) {
            existingEntry.rawValue = resolvedVendorCode;
            existingEntry.finalValue = resolvedVendorCode;
            existingEntry.confidence = 95;
            existingEntry.extractionMethod = 'OCR';
          } else {
            attributeEntries.push({
              attributeId: vendorCodeAttributeId,
              rawValue: resolvedVendorCode,
              finalValue: resolvedVendorCode,
              confidence: 95,
              extractionMethod: 'OCR'
            });
          }
        }
      }

      const job = await prisma.extractionJob.create({
        data: {
          userId: userId ?? null,
          categoryId: fallbackCategory.id,
          imageUrl: image ?? '',
          status: 'COMPLETED',
          aiModel: result.modelUsed ?? null,
          processingTimeMs: result.processingTime ?? null,
          tokensUsed: result.tokensUsed ?? null,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          apiCost: result.apiCost ?? null,
          totalAttributes: schema.length,
          extractedCount: attributeEntries.length,
          avgConfidence: result.confidence ?? null,
          completedAt: new Date(),
          designNumber: null, // articleNumber is assigned only after successful SAP sync
        },
      });

      if (attributeEntries.length > 0) {
        await prisma.extractionResult.createMany({
          data: attributeEntries.map((entry) => ({
            jobId: job.id,
            attributeId: entry.attributeId,
            rawValue: entry.rawValue,
            finalValue: entry.finalValue,
            confidence: entry.confidence as any,
            extractionMethod: entry.extractionMethod,
          })),
        });
      }

      // Flatten to flat table for fast querying
      let flatId: string | null = null;
      try {
        const { flatteningService } = await import('../services/flatteningService');
        await flatteningService.flattenExtractionResults(job.id);
        const flatRow = await prisma.extractionResultFlat.findUnique({
          where: { jobId: job.id },
          select: { id: true, gsm: true, weight: true }
        });
        flatId = flatRow?.id ?? null;

        // Direct backfill for gsm and weight — these schema keys (gsm, weight) may not
        // match any MasterAttribute in the DB (which uses GRAM_PER_SQUARE_METER, OUNCE, etc.)
        // so ExtractionResult records aren't saved for them, leaving the flat row with nulls.
        // Read them directly from result.attributes and fill in any gaps.
        if (flatId) {
          const attrs = result.attributes || {};
          const gsmAttr = attrs['gsm'] ?? attrs['GSM'] ?? attrs['GRAM_PER_SQUARE_METER'] ?? null;
          const weightAttr = attrs['weight'] ?? attrs['WEIGHT'] ?? attrs['g_weight'] ?? attrs['G-Weight'] ?? null;

          const directFill: Record<string, string> = {};

          if (!flatRow?.gsm && gsmAttr) {
            const v = gsmAttr.schemaValue ?? gsmAttr.rawValue;
            if (v != null && String(v).trim() !== '') directFill.gsm = String(v).trim();
          }

          if (!flatRow?.weight && weightAttr) {
            const v = weightAttr.schemaValue ?? weightAttr.rawValue;
            if (v != null && String(v).trim() !== '') {
              const match = String(v).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
              if (match) directFill.weight = match[1];
            }
          }

          if (presentationsType) {
            directFill.presentationsType = presentationsType;
          }

          if (image) {
            void this.vlmService.extractAllFashionAttributes(image).then(rawAttrs => {
              if (rawAttrs && flatId) {
                prisma.extractionResultFlat.update({
                  where: { id: flatId },
                  data: { imageExtractionRawData: rawAttrs },
                }).catch(e => console.warn('[ExtractAll] DB update failed:', e?.message));
              }
            });
          }

          if (Object.keys(directFill).length > 0) {
            await prisma.extractionResultFlat.update({ where: { id: flatId }, data: directFill });
            void mirror360FlatUpdate(flatId, directFill);
          }
        }
      } catch (flatError) {
        console.warn('Failed to flatten extraction results:', flatError);
      }

      // If watcher fields are provided, override the flat row with them
      // AND immediately compute all derived fields (season, year, HSN, segment, articleDescription)
      // so they don't have to wait for the approver dashboard to trigger backfills
      const { watcherFields } = params;
      if (watcherFields && flatId) {
        try {
          // ── Step 1: Folder-path overrides (always authoritative for watcher) ──
          const overrides: Record<string, any> = {};
          if (watcherFields.division)       overrides.division      = watcherFields.division;
          if (watcherFields.vendorName)     overrides.vendorName    = watcherFields.vendorName;
          // Folder vendor code takes priority; fall back to OCR-extracted code if folder had none
          if (watcherFields.vendorCode)     overrides.vendorCode    = watcherFields.vendorCode;
          else if (ocrVendorCode)           overrides.vendorCode    = ocrVendorCode;
          if (watcherFields.majorCategory)  overrides.majorCategory = watcherFields.majorCategory;
          // Always override subDivision: use watcher value if provided, else null
          // This prevents the wrong fallback category's sub-code (e.g. MENS) from staying
          if (watcherFields.division) overrides.subDivision = watcherFields.subDivision || null;
          if (watcherFields.mcCode)         overrides.mcCode        = watcherFields.mcCode;
          if (watcherFields.source)         overrides.source        = watcherFields.source;
          if (watcherFields.imageUncPath)   overrides.imageUncPath  = watcherFields.imageUncPath;

          // ── Step 2: Derived fields (same logic as approver dashboard backfills) ──
          // Year — always current year
          const now = new Date();
          overrides.year = String(now.getFullYear());

          // Season — derived from current month
          const month = now.getMonth() + 1;
          const yearShort = overrides.year.slice(-2);
          if (month >= 1 && month <= 3)       overrides.season = `SP${yearShort}`;
          else if (month >= 4 && month <= 6)  overrides.season = `S${yearShort}`;
          else if (month >= 7 && month <= 9)  overrides.season = `A${yearShort}`;
          else                                overrides.season = `W${yearShort}`;

          // HSN Tax Code — derived from mc_code
          const mcCodeForHsn = watcherFields.mcCode;
          if (mcCodeForHsn) {
            const hsn = getHsnCodeByMcCode(mcCodeForHsn);
            if (hsn) overrides.hsnTaxCode = hsn;
          }

          // ── Step 3: Apply overrides first, then compute segment + article description ──
          await prisma.extractionResultFlat.update({
            where: { id: flatId },
            data: overrides,
          });
          void mirror360FlatUpdate(flatId, overrides);

          // ── Step 4: Segment + Article Description (need the updated row values) ──
          const updatedRow = await prisma.extractionResultFlat.findUnique({
            where: { id: flatId },
            select: {
              majorCategory: true, mrp: true,
              yarn1: true, yarn2: true, fabricMainMvgr: true, weave: true,
              mFab2: true, composition: true, finish: true, gsm: true,
              shade: true, lycra: true, neck: true, neckDetails: true,
              collar: true, placket: true, sleeve: true, bottomFold: true,
              frontOpenStyle: true, pocketType: true, fit: true, pattern: true,
              length: true, drawcord: true, button: true, zipper: true,
              zipColour: true, printType: true, printStyle: true,
              printPlacement: true, patches: true, patchesType: true,
              embroidery: true, embroideryType: true, wash: true,
              fatherBelt: true, childBelt: true,
            }
          });

          if (updatedRow) {
            const derivedStep2: Record<string, any> = {};

            // Segment
            const seg = getSegmentByCategoryAndMrp(updatedRow.majorCategory, updatedRow.mrp);
            if (seg) derivedStep2.segment = seg;

            // Article Description — only include fields visible in the article card for this major category
            const artDesc = buildArticleDescription(updatedRow as any, 40, {
              excludeFields: await getExcludedDescriptionFields(updatedRow.majorCategory) as any,
            });
            if (artDesc) derivedStep2.articleDescription = artDesc;

            if (Object.keys(derivedStep2).length > 0) {
              await prisma.extractionResultFlat.update({
                where: { id: flatId },
                data: derivedStep2,
              });
              void mirror360FlatUpdate(flatId, derivedStep2);
            }
          }
        } catch (overrideError) {
          console.warn('⚠️ Failed to apply watcher field overrides:', overrideError);
        }
      }

      // ── User-Selected Division/SubDivision Override ──────────────────────
      // When the user explicitly passed department/subDepartment in the request
      // (from the Simplified Extraction Page), apply them as authoritative overrides
      // on the flat record so they win over any VLM-extracted or JSON-fallback values.
      if (!watcherFields && flatId && (params.department || params.subDepartment)) {
        try {
          const scopeOverrides: Record<string, any> = {};
          if (params.department)     scopeOverrides.division    = params.department;
          if (params.subDepartment)  scopeOverrides.subDivision = params.subDepartment;
          if (Object.keys(scopeOverrides).length > 0) {
            await prisma.extractionResultFlat.update({
              where: { id: flatId },
              data: scopeOverrides,
            });
            console.log(`[Extraction] Applied user scope override for flat ${flatId}:`, scopeOverrides);
          }
        } catch (scopeOverrideError) {
          console.warn('⚠️ Failed to apply user scope overrides:', scopeOverrideError);
        }
      }

      // ── Kids Division Duplication ────────────────────────────────────────
      // Disabled: only 1 article is created per extraction (no copies).
      // if (flatId) {
      //   void duplicateForKidsDivision(flatId);
      // }

      // ── Variant Creation ─────────────────────────────────────────────────
      // Disabled: auto variant creation on extraction is turned off.
      // if (flatId) {
      //   void createVariantsForGeneric(flatId);
      // }

      return {
        jobId: job.id,
        flatId
      };
    } catch (error: any) {
      console.error('Critical error in persistExtractionJob:', error?.message, error?.stack);
      return null;
    }
  }

  /**
   * Enhanced Multi-VLM Fashion Extraction from Upload
   */
  extractFromUploadVLM = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

      // Parse the request body
      const {
        schema,
        categoryName,
        customPrompt,
        discoveryMode,
        department,
        subDepartment,
        season,
        occasion,
        // Watcher-provided fields (only present when source = 'WATCHER')
        source,
        image_unc_path,
        watcher_division,
        watcher_vendor_name,
        watcher_vendor_code,
        watcher_major_category,
        watcher_sub_division,
        watcher_mc_code,
      } = req.body;

      // Duplicate check: reject if this UNC path was already processed
      if (source === 'WATCHER' && image_unc_path) {
        const existing = await prisma.extractionResultFlat.findUnique({
          where: { imageUncPath: image_unc_path },
          select: { id: true }
        });
        if (existing) {
          res.status(409).json({
            success: false,
            error: 'Image already processed',
            code: 'DUPLICATE'
          });
          return;
        }
      }

      // RBAC: Enforce Division/SubDivision for Creators
      let enforcedDepartment = department;
      let enforcedSubDepartment = subDepartment;

      const userRole = String(req.user?.role || '');
      const currentUser = req.user;
      if (userRole === 'CREATOR') {
        if (currentUser?.division) {
          const userDivisions = String(currentUser.division).split(/[;,|]+/).map((d) => d.trim()).filter(Boolean);
          if (userDivisions.length === 1) {
            enforcedDepartment = userDivisions[0];
          } else {
            const isAllowed = userDivisions.some(
              (d) => d.toUpperCase() === String(department || '').trim().toUpperCase()
            );
            if (!isAllowed) {
              res.status(403).json({
                success: false,
                error: `Access denied. You can only extract for your assigned divisions: ${userDivisions.join(', ')}.`,
                timestamp: Date.now()
              });
              return;
            }
          }
        }
        // Use the user's selected sub-division from the request (dropdown selection).
        // Only fall back to profile sub-division if nothing was selected AND it's a single value.
        if (!enforcedSubDepartment && currentUser?.subDivision && !String(currentUser.subDivision).includes(',')) {
          enforcedSubDepartment = currentUser.subDivision;
        }
      }

      if (!schema) {
        res.status(400).json({
          success: false,
          error: 'Schema is required',
          timestamp: Date.now()
        });
        return;
      }

      let parsedSchema: SchemaItem[];
      try {
        parsedSchema = typeof schema === 'string' ? JSON.parse(schema) : schema;
      } catch (error) {
        res.status(400).json({
          success: false,
          error: 'Invalid schema format',
          timestamp: Date.now()
        });
        return;
      }

      // If schema is empty (e.g. watcher sending schema=[]), build schema matching
      // the frontend: use category-specific attributes if configured, otherwise all active master attributes
      let resolvedCategoryCode: string | undefined;
      if (parsedSchema.length === 0 && source === 'WATCHER') {
        try {
          // Resolve DB category from sub_division + division for correct persistence
          if (watcher_sub_division && watcher_division) {
            const matchedCat = await prisma.category.findFirst({
              where: {
                subDepartment: {
                  code: { equals: watcher_sub_division, mode: 'insensitive' },
                  department: { name: { equals: watcher_division, mode: 'insensitive' } }
                }
              },
              select: { code: true }
            });
            if (matchedCat) resolvedCategoryCode = matchedCat.code;
          }

          // Try category-specific schema first (same as frontend uses)
          if (resolvedCategoryCode) {
            const catAttrs = await prisma.categoryAttribute.findMany({
              where: {
                category: { code: resolvedCategoryCode },
                isEnabled: true
              },
              orderBy: { displayOrder: 'asc' },
              include: {
                attribute: {
                  include: {
                    allowedValues: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } }
                  }
                }
              }
            });
            if (catAttrs.length > 0) {
              parsedSchema = catAttrs.map(ca => ({
                key: ca.attribute.key,
                label: ca.attribute.label || ca.attribute.key,
                type: ca.attribute.type.toLowerCase() as any,
                allowedValues: ca.attribute.allowedValues.map(av => av.shortForm),
              }));
            }
          }

          // Fall back to all active master attributes if no category config exists
          if (parsedSchema.length === 0) {
            const masterAttrs = await prisma.masterAttribute.findMany({
              where: { isActive: true },
              orderBy: { displayOrder: 'asc' },
              include: {
                allowedValues: { where: { isActive: true }, orderBy: { displayOrder: 'asc' } }
              }
            });
            parsedSchema = masterAttrs.map(attr => ({
              key: attr.key,
              label: attr.label || attr.key,
              type: attr.type.toLowerCase() as any,
              allowedValues: attr.allowedValues.map(av => av.shortForm),
            }));
          }
        } catch (schemaErr: any) {
          console.warn(`⚠️ Watcher schema build failed: ${schemaErr.message}`);
        }
      }

      // Convert image to base64 for VLM processing
      const base64Image = await ImageProcessor.processImageToBase64(req.file);

      // Create enhanced fashion extraction request
      const vlmRequest: FashionExtractionRequest = {
        image: base64Image,
        schema: parsedSchema,
        categoryName,
        customPrompt,
        discoveryMode: discoveryMode === 'true' || discoveryMode === true,
        department: (enforcedDepartment || watcher_division) as any,
        subDepartment: (enforcedSubDepartment || watcher_sub_division) as any,
        season: season as any,
        occasion: occasion as any
      };

      // Extract using Multi-VLM pipeline
      const result = await this.vlmService.extractFashionAttributes(vlmRequest);

      // Upload to Cloudflare R2 (REQUIRED - fail if this doesn't work)
      let imagePath = '';
      const timestamp = Date.now();
      const originalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const fileName = `${timestamp}_${originalName}`;

      try {
        const uploadResult = await storageService.uploadFile(
          ImageProcessor.getBuffer(req.file),
          req.file.originalname, // Pass original name for UUID naming
          req.file.mimetype,
          'fashion-images'
        );
        imagePath = uploadResult.url;
      } catch (uploadError: any) {
        console.error('R2 Upload Failed:', uploadError);
        console.error('   Error details:', uploadError.message);

        // Return error to user - don't proceed without image storage
        res.status(500).json({
          success: false,
          error: 'Failed to upload image to cloud storage',
          details: uploadError.message,
          timestamp: Date.now()
        });
        return;
      }

      // Verify we have a valid image URL
      if (!imagePath) {
        res.status(500).json({
          success: false,
          error: 'Image upload succeeded but no URL was returned',
          timestamp: Date.now()
        });
        return;
      }


      const relativePathFromBody = (req.body?.relativePath || req.body?.webkitRelativePath || '') as string;
      const folderNameFromBody = (req.body?.folderName || req.body?.vendorCodeFolder || '') as string;
      const effectiveFolderName = folderNameFromBody
        || (relativePathFromBody && relativePathFromBody.includes('/') ? relativePathFromBody.split('/')[0] : undefined)
        || (req.file.originalname.includes('/') ? req.file.originalname.split('/')[0] : undefined)
        || (req.file.originalname.includes('\\') ? req.file.originalname.split('\\')[0] : undefined)
        || undefined;
      const originalFilenameWithoutExt = (req.file.originalname.split(/[\\/]/).pop() || req.file.originalname)
        .replace(/\.[^/.]+$/, '');

      const persistence = await this.persistExtractionJob({
        image: imagePath,
        schema: parsedSchema,
        categoryName,
        resolvedCategoryCode,
        userId: req.user?.id,
        result,
        originalFilename: originalFilenameWithoutExt,
        folderName: effectiveFolderName,
        department: enforcedDepartment,
        subDepartment: enforcedSubDepartment,
        presentationsType: source === 'WATCHER' ? undefined : 'FG Article',
        watcherFields: source === 'WATCHER' ? {
          division:      watcher_division      || undefined,
          vendorName:    watcher_vendor_name   || undefined,
          vendorCode:    watcher_vendor_code   || undefined,
          majorCategory: watcher_major_category || undefined,
          subDivision:   watcher_sub_division  || undefined,
          mcCode:        watcher_mc_code       || undefined,
          source:        'WATCHER',
          imageUncPath:  image_unc_path        || undefined,
        } : undefined,
      });

      res.json({
        success: true,
        data: {
          ...result,
          persistence
        },
        metadata: {
          enhancedMode: true,
          vlmPipeline: 'multi-model',
          fashionSpecialized: true,
          imageUrl: imagePath
        },
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('❌ Enhanced VLM extraction failed:', error);
      next(error);
    } finally {
      // Clean up disk-stored temp file (watcher uses diskStorage; no-op for memoryStorage)
      if (req.file) ImageProcessor.cleanup(req.file);
    }
  };

  /**
   * Enhanced Multi-VLM Fashion Extraction from Base64
   */
  extractFromBase64VLM = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        image,
        schema,
        categoryName,
        customPrompt,
        discoveryMode,
        forceRefresh,
        department,
        subDepartment,
        season,
        occasion,
        fileName, // Optional: original filename
        folderName, // Optional: vendor code source from uploaded folder
        presentationsType, // Optional: e.g. 'FG Article', 'Fabric Article'
      }: ExtractionRequest & {
        department?: string;
        subDepartment?: string;
        season?: string;
        occasion?: string;
        fileName?: string;
        folderName?: string;
        presentationsType?: string;
      } = req.body;

      // RBAC: Enforce Division/SubDivision for Creators
      let enforcedDepartment = department;
      let enforcedSubDepartment = subDepartment;

      const userRole = String(req.user?.role || '');
      const currentUser = req.user;
      if (userRole === 'CREATOR') {
        if (currentUser?.division) {
          const userDivisions = String(currentUser.division).split(/[;,|]+/).map((d) => d.trim()).filter(Boolean);
          if (userDivisions.length === 1) {
            enforcedDepartment = userDivisions[0];
          } else {
            const isAllowed = userDivisions.some(
              (d) => d.toUpperCase() === String(department || '').trim().toUpperCase()
            );
            if (!isAllowed) {
              res.status(403).json({
                success: false,
                error: `Access denied. You can only extract for your assigned divisions: ${userDivisions.join(', ')}.`,
                timestamp: Date.now()
              });
              return;
            }
          }
        }
        // Use the user's selected sub-division from the request (dropdown selection).
        // Only fall back to profile sub-division if nothing was selected AND it's a single value.
        if (!enforcedSubDepartment && currentUser?.subDivision && !String(currentUser.subDivision).includes(',')) {
          enforcedSubDepartment = currentUser.subDivision;
        }
        // Block extraction entirely if sub-division is still not resolved for CREATOR role
        if (!enforcedSubDepartment) {
          res.status(400).json({
            success: false,
            error: 'Sub-Division is required. Please select a Sub-Division before extracting.',
            timestamp: Date.now()
          });
          return;
        }
      }

      if (!image) {
        res.status(400).json({
          success: false,
          error: 'Base64 image is required',
          timestamp: Date.now()
        });
        return;
      }

      if (!schema) {
        res.status(400).json({
          success: false,
          error: 'Schema is required',
          timestamp: Date.now()
        });
        return;
      }

      // Create enhanced fashion extraction request
      const vlmRequest: FashionExtractionRequest = {
        image,
        schema,
        categoryName,
        customPrompt,
        discoveryMode: discoveryMode || false,
        department: enforcedDepartment as any,
        subDepartment: enforcedSubDepartment as any,
        season: season as any,
        occasion: occasion as any
      };

      const result = await this.vlmService.extractFashionAttributes(vlmRequest);

      // Upload base64 image to Cloudflare R2
      let imagePath: string | null = null;
      try {
        // Convert base64 to buffer
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Determine file extension from base64 prefix or use default
        let extension = 'jpg';
        const base64Prefix = image.match(/^data:image\/(\w+);base64,/);
        if (base64Prefix) {
          extension = base64Prefix[1];
        }

        // Use provided filename or generate one
        const originalName = fileName || `upload_${Date.now()}.${extension}`;

        const uploadResult = await storageService.uploadFile(
          imageBuffer,
          originalName,
          `image/${extension}`,
          'fashion-images'
        );
        imagePath = uploadResult.url;
      } catch (uploadError: any) {
        console.error('❌ R2 Upload Failed for base64 image:', uploadError.message);
        res.status(500).json({
          success: false,
          error: 'Failed to upload image to cloud storage',
          details: uploadError.message,
          timestamp: Date.now()
        });
        return;
      }

      if (!imagePath) {
        res.status(500).json({
          success: false,
          error: 'Image upload succeeded but no URL was returned',
          timestamp: Date.now()
        });
        return;
      }

      const parsedFolderFromFileName = typeof fileName === 'string' && (fileName.includes('/') || fileName.includes('\\'))
        ? fileName.split(/[\\/]/)[0]
        : null;
      const originalFilenameWithoutExt = (typeof fileName === 'string' && fileName.length > 0
        ? fileName.split(/[\\/]/).pop() || fileName
        : undefined)?.replace(/\.[^/.]+$/, '');

      const persistence = await this.persistExtractionJob({
        image: imagePath,
        schema,
        categoryName,
        userId: req.user?.id,
        result,
        originalFilename: originalFilenameWithoutExt,
        folderName: folderName || parsedFolderFromFileName || undefined,
        department: enforcedDepartment,
        subDepartment: enforcedSubDepartment,
        presentationsType: presentationsType || 'FG Article',
      });

      res.json({
        success: true,
        data: {
          ...result,
          persistence
        },
        metadata: {
          enhancedMode: true,
          vlmPipeline: 'multi-model',
          fashionSpecialized: true,
          imageUrl: imagePath // Include R2 URL in response
        },
        timestamp: Date.now()
      });

    } catch (error) {
      console.error('❌ Enhanced VLM extraction failed:', error);
      next(error);
    }
  };

  /**
   * Enhanced Multi-VLM Fashion Extraction (Alias for backward compatibility)
   */
  extractWithAdvancedVLM = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    return this.extractFromBase64VLM(req, res, next);
  };

  /**
   * 📊 VLM System Health Check
   */
  vlmHealthCheck = async (req: Request, res: Response) => {
    try {
      const healthStatus = await this.vlmService.checkProviderHealth();
      const healthySystems = Object.values(healthStatus).filter(Boolean).length;
      const totalSystems = Object.keys(healthStatus).length;

      res.json({
        success: true,
        message: `VLM System Status: ${healthySystems}/${totalSystems} providers healthy`,
        data: {
          providers: healthStatus,
          systemHealth: healthySystems / totalSystems,
          recommendation: this.getSystemRecommendation(healthStatus)
        },
        timestamp: Date.now(),
        version: '2.0.0-vlm'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'VLM health check failed',
        timestamp: Date.now()
      });
    }
  };

  /**
   * ⚙️ Configure VLM Providers
   */
  configureVLMProvider = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { providerId, config } = req.body;

      if (!providerId || !config) {
        res.status(400).json({
          success: false,
          error: 'Provider ID and configuration are required',
          timestamp: Date.now()
        });
        return;
      }

      await this.vlmService.configureProvider(providerId, config);

      res.json({
        success: true,
        message: `Provider ${providerId} configured successfully`,
        timestamp: Date.now()
      });

    } catch (error) {
      next(error);
    }
  };

  /**
   * 🔍 Get system recommendation based on provider health
   */
  private getSystemRecommendation(healthStatus: Record<string, boolean>): string {
    const healthy = Object.values(healthStatus).filter(Boolean).length;
    const total = Object.keys(healthStatus).length;

    if (healthy === total) {
      return 'All systems operational - optimal performance expected';
    } else if (healthy >= total * 0.75) {
      return 'Most systems operational - good performance expected';
    } else if (healthy >= total * 0.5) {
      return 'Some systems down - reduced performance, fallbacks active';
    } else {
      return 'Multiple systems down - limited functionality, check configurations';
    }
  }

  /**
   * Enhanced Category-Based Extraction (Database-Driven Schema)
   */
  extractFromCategoryCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        image,
        categoryCode,
        vendorName,
        designNumber,
        costPrice,
        sellingPrice,
        notes,
        discoveryMode,
        customPrompt,
        fileName,
        folderName
      } = req.body;

      // Validate required fields
      if (!image) {
        res.status(400).json({
          success: false,
          error: 'Base64 image is required',
          timestamp: Date.now()
        });
        return;
      }

      if (!categoryCode) {
        res.status(400).json({
          success: false,
          error: 'Category code is required',
          timestamp: Date.now()
        });
        return;
      }

      // Load schema from database
      const { category, schema, stats } = await this.schemaService.getCategorySchema(categoryCode);

      // RBAC: Verify Creator Access
      const userRole = String(req.user?.role || '');
      const currentUser = req.user;
      if (userRole === 'CREATOR') {
        if (currentUser?.division) {
          const userDivisions = String(currentUser.division)
            .split(/[;,|]+/)
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);
          if (userDivisions.length > 0 && !userDivisions.includes(category.department.name.toLowerCase())) {
            res.status(403).json({
              success: false,
              error: `Access denied. You can only access categories in ${currentUser.division}.`,
              timestamp: Date.now()
            });
            return;
          }
        }
        if (currentUser?.subDivision && category.subDepartment.code.toLowerCase() !== currentUser.subDivision.toLowerCase()) {
          res.status(403).json({
            success: false,
            error: `Access denied. You can only access categories in ${currentUser.subDivision}.`,
            timestamp: Date.now()
          });
          return;
        }
      }

      // Create enhanced fashion extraction request with garment type
      const vlmRequest: FashionExtractionRequest = {
        image,
        schema,
        categoryName: category.name,
        customPrompt,
        discoveryMode: discoveryMode === 'true' || discoveryMode === true || false,
        department: category.department.name.toLowerCase() as any,
        garmentType: category.garmentType, // NEW: For specialized prompts
        subDepartment: category.subDepartment.code as any
      };

      // Extract using Multi-VLM pipeline
      const result = await this.vlmService.extractFashionAttributes(vlmRequest);

      // Merge extracted metadata with provided metadata
      const finalMetadata = {
        vendorName: result.extractedMetadata?.vendorName || vendorName || null,
        designNumber: result.extractedMetadata?.designNumber || designNumber || null,
        costPrice: result.extractedMetadata?.price || (costPrice ? parseFloat(costPrice) : null),
        sellingPrice: sellingPrice ? parseFloat(sellingPrice) : null,
        pptNumber: result.extractedMetadata?.pptNumber || null,
        notes,
        extractionDate: new Date().toISOString()
      };

      // Upload base64 image to Cloudflare R2 (required for consistent storage)
      let imagePath = '';
      try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        let extension = 'jpg';
        const base64Prefix = image.match(/^data:image\/(\w+);base64,/);
        if (base64Prefix) {
          extension = base64Prefix[1];
        }

        const originalName = fileName || `upload_${Date.now()}.${extension}`;

        const uploadResult = await storageService.uploadFile(
          imageBuffer,
          originalName,
          `image/${extension}`,
          'fashion-images'
        );

        imagePath = uploadResult.url;
      } catch (uploadError: any) {
        console.error('R2 Upload Failed for category extraction image:', uploadError);
        console.error('   Error details:', uploadError.message);

        res.status(500).json({
          success: false,
          error: 'Failed to upload image to cloud storage',
          details: uploadError.message,
          timestamp: Date.now()
        });
        return;
      }

      if (!imagePath) {
        res.status(500).json({
          success: false,
          error: 'Image upload succeeded but no URL was returned',
          timestamp: Date.now()
        });
        return;
      }

      const persistence = await this.persistExtractionJob({
        image: imagePath,
        schema,
        categoryName: category.name,
        userId: req.user?.id,
        result,
        originalFilename: typeof fileName === 'string'
          ? (fileName.split(/[\\/]/).pop() || fileName).replace(/\.[^/.]+$/, '')
          : undefined,
        folderName: folderName
          || (typeof fileName === 'string' && (fileName.includes('/') || fileName.includes('\\'))
            ? fileName.split(/[\\/]/)[0]
            : undefined),
        department: category.department.name,
        subDepartment: category.subDepartment.code,
        presentationsType: 'FG Article',
      });

      res.json({
        success: true,
        data: {
          ...result,
          category: {
            code: category.code,
            name: category.name,
            fullForm: category.fullForm,
            department: category.department.name,
            subDepartment: category.subDepartment.name,
            fabricDivision: category.fabricDivision
          },
          metadata: finalMetadata,
          persistence,
          schemaStats: stats,
          imageUrl: imagePath
        },
        timestamp: Date.now()
      });

    } catch (error: any) {
      console.error('❌ Category-based extraction failed:', error);
      if (error.message?.includes('not found')) {
        res.status(404).json({
          success: false,
          error: error.message,
          timestamp: Date.now()
        });
        return;
      }
      next(error);
    }
  };

  /**
   * 📂 Get Category Hierarchy for Dropdown
   */
  getCategoryHierarchy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const hierarchy = await this.schemaService.getCategoryHierarchy();

      res.json({
        success: true,
        data: hierarchy,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ Failed to fetch hierarchy:', error);
      next(error);
    }
  };

  /**
   * 🔍 Get Category Schema (for preview/debugging)
   */
  getCategorySchema = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { code } = req.params;
      const schemaData = await this.schemaService.getCategorySchema(code);

      res.json({
        success: true,
        data: schemaData,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error(`❌ Failed to fetch schema for ${req.params.code}:`, error);
      if (error.message?.includes('not found')) {
        res.status(404).json({
          success: false,
          error: error.message,
          timestamp: Date.now()
        });
        return;
      }
      next(error);
    }
  };

  /**
   * 🔎 Search Categories
   */
  searchCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, limit } = req.query;

      if (!q || typeof q !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Query parameter "q" is required',
          timestamp: Date.now()
        });
        return;
      }

      const results = await this.schemaService.searchCategories(q, limit ? parseInt(limit as string) : 20);

      res.json({
        success: true,
        data: results,
        count: results.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ Search failed:', error);
      next(error);
    }
  };
}