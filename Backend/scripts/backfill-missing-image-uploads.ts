/**
 * Backfill missing image uploads to Cloudflare R2.
 *
 * This script targets extraction jobs where `imageUrl` is missing/placeholder
 * and tries to recover source files from a local folder, then uploads to R2.
 *
 * Usage:
 *   ts-node scripts/backfill-missing-image-uploads.ts --source-dir "C:/path/to/images" --dry-run
 *   ts-node scripts/backfill-missing-image-uploads.ts --source-dir "C:/path/to/images"
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma';

dotenv.config();

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const sourceDir = getArgValue('--source-dir') || path.resolve(process.cwd(), 'uploads', 'images');

function looksUploaded(url?: string | null): boolean {
  if (!url) return false;
  const v = url.trim();
  if (!v) return false;
  if (v === 'base64_upload') return false;
  return v.startsWith('http://') || v.startsWith('https://');
}

function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.push(full);
      }
    }
  }

  await walk(root);
  return out;
}

function buildFileIndex(files: string[]): Map<string, string[]> {
  const byBase = new Map<string, string[]>();
  for (const filePath of files) {
    const key = path.basename(filePath).toLowerCase();
    const arr = byBase.get(key) || [];
    arr.push(filePath);
    byBase.set(key, arr);
  }
  return byBase;
}

async function run() {
  console.log('🖼️ Backfill missing image uploads');
  console.log(`Source directory: ${sourceDir}`);
  console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`);

  try {
    await fs.access(sourceDir);
  } catch {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const files = await walkFiles(sourceDir);
  const fileIndex = buildFileIndex(files);

  console.log(`Indexed files: ${files.length}`);

  const candidates = await prisma.extractionJob.findMany({
    where: {
      OR: [
        { imageUrl: 'base64_upload' },
        { imageUrl: '' }
      ]
    },
    select: {
      id: true,
      imageUrl: true,
      designNumber: true,
      flatResult: {
        select: {
          imageUrl: true
        }
      }
    }
  });

  let scanned = 0;
  let matched = 0;
  let uploaded = 0;
  let missingSource = 0;
  let skippedAlreadyUploaded = 0;
  let failed = 0;

  const { storageService } = await import('../src/services/storageService');

  for (const row of candidates) {
    scanned++;

    if (looksUploaded(row.imageUrl) || looksUploaded(row.flatResult?.imageUrl)) {
      skippedAlreadyUploaded++;
      continue;
    }

    const fileNameCandidates = [
      row.designNumber || undefined
    ]
      .filter(Boolean)
      .map((name) => path.basename(String(name)).trim())
      .filter(Boolean);

    let sourceFile: string | undefined;

    for (const fileName of fileNameCandidates) {
      const direct = fileIndex.get(fileName.toLowerCase());
      if (direct && direct.length > 0) {
        sourceFile = direct[0];
        break;
      }

      if (!path.extname(fileName)) {
        const variants = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];
        for (const ext of variants) {
          const viaExt = fileIndex.get(`${fileName}${ext}`.toLowerCase());
          if (viaExt && viaExt.length > 0) {
            sourceFile = viaExt[0];
            break;
          }
        }
        if (sourceFile) break;
      }
    }

    if (!sourceFile) {
      missingSource++;
      continue;
    }

    matched++;

    if (isDryRun) {
      uploaded++;
      continue;
    }

    try {
      const buffer = await fs.readFile(sourceFile);
      const originalName = path.basename(sourceFile);
      const mimeType = inferMimeType(originalName);

      const uploadResult = await storageService.uploadFile(
        Buffer.from(buffer),
        originalName,
        mimeType,
        'fashion-images'
      );

      await prisma.extractionJob.update({
        where: { id: row.id },
        data: { imageUrl: uploadResult.url }
      });

      if (row.flatResult) {
        await prisma.extractionResultFlat.update({
          where: { jobId: row.id },
          data: { imageUrl: uploadResult.url }
        });
      }

      uploaded++;
    } catch (error) {
      failed++;
      console.error(`❌ Failed job ${row.id}:`, error);
    }
  }

  console.log('\nSummary');
  console.log(`- Candidates scanned: ${scanned}`);
  console.log(`- Source matched: ${matched}`);
  console.log(`- Uploaded/updated: ${uploaded}${isDryRun ? ' (dry-run)' : ''}`);
  console.log(`- Missing source file: ${missingSource}`);
  console.log(`- Skipped already uploaded: ${skippedAlreadyUploaded}`);
  console.log(`- Failed: ${failed}`);
}

run()
  .catch((error) => {
    console.error('❌ Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
