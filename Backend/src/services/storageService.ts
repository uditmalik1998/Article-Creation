
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, type ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import { runPythonWatermark } from '../utils/runPythonWatermark';

/**
 * Optional payload of SRM/article fields to stamp on the image. Every field is
 * optional — Python skips lines whose value is null/empty. When present on
 * `uploadApprovedImageFromSourceUrl`, the server-side S3-to-S3 copy is bypassed
 * (we have to touch the bytes to draw the label) and the output is encoded as
 * JPEG q=90 so the article-master bucket doesn't fill up with multi-MB PNGs.
 */
export interface WatermarkLabel {
  article_number?: string | null;
  presentation_no?: string | null;
  vendor_code?: string | null;
  vendor_name?: string | null;
  division?: string | null;
  sub_division?: string | null;
  major_category?: string | null;
  design_number?: string | null;
  mc_code?: string | null;
  hsn_tax_code?: string | null;
  fabric?: string | null;
  no_of_colors?: number | null;
  season?: string | null;
  year?: string | null;
  rate?: number | string | null;
  mrp?: number | string | null;
  approved_by?: string | null;
}

// Custom HTTPS agent: disables TLS packet-length strict checks that cause
// EPROTO errors when Node.js OpenSSL rejects R2's TLS handshake on some networks.
const r2HttpsAgent = new https.Agent({
    secureOptions: require('constants').SSL_OP_LEGACY_SERVER_CONNECT,
    keepAlive: true,
});

export interface UploadResult {
    url: string;
    path: string;
    key: string;
    uuid: string;
}

export class StorageService {
    private s3Client: S3Client;
    private bucket: string;
    private publicUrlBase: string | undefined;
    private approvedS3Client: S3Client;
    private approvedBucket: string;
    private approvedPublicUrlBase: string | undefined;
    private modelImagesS3Client: S3Client;
    private modelImagesBucket: string;
    private modelImagesPublicUrlBase: string | undefined;

    private normalizeEnv(value?: string | null): string | undefined {
        const v = String(value || '').trim();
        return v || undefined;
    }

    private normalizeAccountId(value?: string | null): string | undefined {
        const raw = String(value || '').trim();
        if (!raw) return undefined;

        const noProto = raw.replace(/^https?:\/\//i, '');
        const hostAndPath = noProto.split('/')[0];
        const withoutSuffix = hostAndPath.replace(/\.r2\.cloudflarestorage\.com$/i, '');
        return withoutSuffix.trim() || undefined;
    }

    private isR2ApiStyleBaseUrl(url?: string): boolean {
        if (!url) return false;
        return /\.r2\.cloudflarestorage\.com(\/|$)/i.test(url);
    }

    private buildPublicUrl(baseUrl: string, bucket: string, key: string): string {
        const base = baseUrl.replace(/\/$/, '');
        const hasBucketInBase = new RegExp(`/${bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|/)`, 'i').test(base);
        return hasBucketInBase ? `${base}/${key}` : `${base}/${key}`;
    }

    constructor() {
        const accountId = this.normalizeAccountId(process.env.R2_ACCOUNT_ID);
        const accessKeyId = this.normalizeEnv(process.env.R2_ACCESS_KEY_ID);
        const secretAccessKey = this.normalizeEnv(process.env.R2_SECRET_ACCESS_KEY);
        this.bucket = this.normalizeEnv(process.env.R2_BUCKET_NAME) || '';
        this.publicUrlBase = this.normalizeEnv(process.env.R2_PUBLIC_URL_BASE); // Custom domain or worker URL

        const approvedAccountId = this.normalizeAccountId(process.env.APPROVED_R2_ACCOUNT_ID) || accountId;
        const approvedAccessKeyId = this.normalizeEnv(process.env.APPROVED_R2_ACCESS_KEY_ID) || accessKeyId;
        const approvedSecretAccessKey = this.normalizeEnv(process.env.APPROVED_R2_SECRET_ACCESS_KEY) || secretAccessKey;
        this.approvedBucket = this.normalizeEnv(process.env.APPROVED_R2_BUCKET_NAME) || this.bucket;
        this.approvedPublicUrlBase = this.normalizeEnv(process.env.APPROVED_R2_PUBLIC_URL_BASE) || this.publicUrlBase;

        if (!accountId || !accessKeyId || !secretAccessKey || !this.bucket) {
            console.warn('⚠️ Cloudflare R2 credentials missing. Storage service may fail.');
        }

        const s3RequestHandler = new NodeHttpHandler({ httpsAgent: r2HttpsAgent });

        this.s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            requestHandler: s3RequestHandler,
            credentials: {
                accessKeyId: accessKeyId || '',
                secretAccessKey: secretAccessKey || ''
            }
        });

        this.approvedS3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${approvedAccountId}.r2.cloudflarestorage.com`,
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            requestHandler: s3RequestHandler,
            credentials: {
                accessKeyId: approvedAccessKeyId || '',
                secretAccessKey: approvedSecretAccessKey || ''
            }
        });

        const modelAccountId = this.normalizeAccountId(process.env.MODEL_IMAGES_R2_ACCOUNT_ID) || accountId;
        const modelAccessKeyId = this.normalizeEnv(process.env.MODEL_IMAGES_R2_ACCESS_KEY_ID) || accessKeyId;
        const modelSecretAccessKey = this.normalizeEnv(process.env.MODEL_IMAGES_R2_SECRET_ACCESS_KEY) || secretAccessKey;
        this.modelImagesBucket = this.normalizeEnv(process.env.MODEL_IMAGES_R2_BUCKET_NAME) || 'model-images';
        this.modelImagesPublicUrlBase = this.normalizeEnv(process.env.MODEL_IMAGES_R2_PUBLIC_URL_BASE);

        this.modelImagesS3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${modelAccountId}.r2.cloudflarestorage.com`,
            forcePathStyle: true,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            requestHandler: s3RequestHandler,
            credentials: {
                accessKeyId: modelAccessKeyId || '',
                secretAccessKey: modelSecretAccessKey || '',
            },
        });
    }

    private isSignatureMismatchError(error: any): boolean {
        const code = String(error?.Code || error?.code || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        return code.includes('signaturedoesnotmatch') || message.includes('signaturedoesnotmatch');
    }

    private isAuthError(error: any): boolean {
        const code = String(error?.Code || error?.code || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        const status = Number(error?.statusCode || error?.$metadata?.httpStatusCode || 0);
        return (
            status === 401 ||
            status === 403 ||
            code.includes('accessdenied') ||
            code.includes('invalidaccesskeyid') ||
            code.includes('signaturenotmatch') ||
            code.includes('signaturedoesnotmatch') ||
            message.includes('access denied') ||
            message.includes('forbidden') ||
            message.includes('invalid access key')
        );
    }

    /**
     * Stamp the source image with article-creation data. Falls back to the
     * original bytes (and original mime/extension) if the Python step fails so
     * that approval is NEVER blocked by a watermarking glitch.
     * Output is always JPEG q=90 on success — keeps catalog-bucket files small.
     */
    private async applyWatermarkOrPassthrough(
        sourceBuffer: Buffer,
        labelData: WatermarkLabel,
        safeArticleNumber: string,
    ): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
        try {
            const wm = await runPythonWatermark(sourceBuffer, labelData as Record<string, unknown>, { format: 'jpeg' });
            if (wm.success && wm.buffer && wm.buffer.length > 0) {
                console.log(`🖋️  Watermark applied for ${safeArticleNumber}: ${wm.buffer.length} bytes, ${wm.durationMs}ms`);
                return {
                    buffer: wm.buffer,
                    mimeType: wm.mimeType || 'image/jpeg',
                    extension: 'jpg',
                };
            }
            console.warn(`⚠️ Watermark step failed for ${safeArticleNumber} (${wm.durationMs}ms): ${wm.error} — uploading unmodified bytes`);
        } catch (err: any) {
            console.warn(`⚠️ Watermark threw for ${safeArticleNumber}: ${err?.message ?? err} — uploading unmodified bytes`);
        }
        return { buffer: sourceBuffer, mimeType: 'image/jpeg', extension: 'jpg' };
    }

    private async putApprovedObject(
        client: S3Client,
        bucket: string,
        key: string,
        fileBuffer: Buffer,
        mimeType: string,
        safeArticleNumber: string
    ): Promise<void> {
        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: fileBuffer,
            ContentType: mimeType,
            Metadata: {
                'article-number': safeArticleNumber,
                'uploaded-after-approval': 'true'
            }
        }));
    }

    private sanitizeArticleNumber(articleNumber: string): string {
        const cleaned = String(articleNumber || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
        return cleaned || `article_${Date.now()}`;
    }

    private normalizeExtension(ext?: string | null): string {
        const normalized = String(ext || '').replace('.', '').toLowerCase().trim();
        if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff'].includes(normalized)) {
            return normalized === 'tif' ? 'tiff' : normalized;
        }
        return 'jpg';
    }

    private extensionFromMimeType(mimeType?: string | null): string | null {
        const normalized = String(mimeType || '').toLowerCase().trim();
        const map: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/bmp': 'bmp',
            'image/avif': 'avif',
            'image/tiff': 'tiff'
        };
        return map[normalized] || null;
    }

    private extensionFromPath(filePathOrUrl?: string | null): string | null {
        const text = String(filePathOrUrl || '').trim();
        if (!text) return null;
        const clean = text.split('?')[0].split('#')[0];
        const ext = clean.includes('.') ? clean.split('.').pop() || '' : '';
        return ext ? this.normalizeExtension(ext) : null;
    }

    /**
     * Uploads a file buffer to Cloudflare R2 with UUID-based naming
     * @param fileBuffer - File buffer to upload
     * @param originalFileName - Original filename (for extension extraction)
     * @param mimeType - MIME type of the file
     * @param folder - Folder path in bucket (default: 'fashion-images')
     * @returns Upload result with URL, path, key, and UUID
     */
    async uploadFile(
        fileBuffer: Buffer,
        originalFileName: string,
        mimeType: string,
        folder: string = 'fashion-images'
    ): Promise<UploadResult> {
        // Generate UUID for unique file identification
        const uuid = randomUUID();

        // Extract file extension from original filename
        const extension = originalFileName.split('.').pop() || 'jpg';

        // Create organized path: folder/YYYY/MM/uuid.ext
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const fileName = `${uuid}.${extension}`;
        const key = `${folder}/${year}/${month}/${fileName}`;

        try {
            const upload = new Upload({
                client: this.s3Client,
                params: {
                    Bucket: this.bucket,
                    Key: key,
                    Body: fileBuffer,
                    ContentType: mimeType,
                    Metadata: {
                        'original-filename': originalFileName,
                        'upload-date': now.toISOString(),
                        'uuid': uuid
                    }
                }
            });

            await upload.done();

            console.log(`✅ Uploaded to R2: ${key}`);

            // R2 URL Construction
            let url: string;
            if (this.publicUrlBase) {
                // If custom domain is configured (e.g., https://cdn.example.com)
                url = this.buildPublicUrl(this.publicUrlBase, this.bucket, key);
            } else {
                // Fallback: Generate signed URL (valid for 7 days - R2/S3 maximum)
                console.warn('⚠️ R2_PUBLIC_URL_BASE not set. Using signed URL (valid for 7 days).');
                url = await this.getSignedUrl(key, 604800); // 7 days (maximum allowed)
            }

            return {
                url,
                path: key,
                key,
                uuid
            };

        } catch (error) {
            console.error('❌ R2 Upload Error:', error);
            throw new Error('Failed to upload file to storage');
        }
    }

    /**
     * Generate a signed URL for a private file in the primary bucket
     * @param key - Object key in R2
     * @param expiresIn - Expiration time in seconds (default: 1 hour)
     */
    async getSignedUrl(key: string, expiresIn = 86400): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key
            });
            const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

            if (!signedUrl) {
                throw new Error('Signed URL generation returned empty result');
            }

            console.log(`✅ Generated signed URL for: ${key} (expires in ${expiresIn}s)`);
            return signedUrl;
        } catch (error: any) {
            console.error('❌ Failed to generate signed URL:', error);
            console.error('   Key:', key);
            console.error('   Bucket:', this.bucket);
            console.error('   Error details:', error.message);
            throw new Error(`Failed to generate signed URL: ${error.message}`);
        }
    }

    /**
     * Generate a signed URL for a file in the approved (article-master) bucket.
     * Use this when the approved bucket's public URL is not accessible.
     * @param key - Object key in the approved bucket (e.g. "ARTICLE123.jpg")
     * @param expiresIn - Expiration time in seconds (default: 7 days)
     */
    async getApprovedSignedUrl(key: string, expiresIn = 604800): Promise<string> {
        try {
            const command = new GetObjectCommand({
                Bucket: this.approvedBucket,
                Key: key
            });
            const signedUrl = await getSignedUrl(this.approvedS3Client, command, { expiresIn });

            if (!signedUrl) {
                throw new Error('Signed URL generation returned empty result');
            }

            console.log(`✅ Generated signed URL for approved bucket: ${key} (expires in ${expiresIn}s)`);
            return signedUrl;
        } catch (error: any) {
            console.error('❌ Failed to generate approved signed URL:', error);
            console.error('   Key:', key);
            console.error('   Bucket:', this.approvedBucket);
            console.error('   Error details:', error.message);
            throw new Error(`Failed to generate approved signed URL: ${error.message}`);
        }
    }

    /**
     * Public URL for a source image in the approved (article-master) bucket.
     * Returns null when no public base is configured (caller can fall back to
     * a signed URL via getApprovedSignedUrl).
     */
    getApprovedPublicUrl(key: string): string | null {
        if (!this.approvedPublicUrlBase || this.isR2ApiStyleBaseUrl(this.approvedPublicUrlBase)) return null;
        return this.buildPublicUrl(this.approvedPublicUrlBase, this.approvedBucket, key);
    }

    /**
     * Extracts the object key from an approved bucket public URL.
     */
    extractApprovedKeyFromUrl(url: string): string | null {
        if (!this.approvedPublicUrlBase) return null;
        const base = this.approvedPublicUrlBase.replace(/\/$/, '');
        if (!url.startsWith(base + '/')) return null;
        return url.slice(base.length + 1) || null;
    }

    /**
     * Extracts the R2 object key from a public URL, if the URL matches our known public base.
     */
    private extractKeyFromPublicUrl(url: string): string | null {
        if (!this.publicUrlBase) return null;
        const base = this.publicUrlBase.replace(/\/$/, '');
        if (!url.startsWith(base + '/')) return null;
        return url.slice(base.length + 1);
    }

    /**
     * Extracts the R2 object key from any URL — public domain or signed R2/S3 URL.
     */
    private extractKeyFromAnyUrl(url: string): string | null {
        const publicKey = this.extractKeyFromPublicUrl(url);
        if (publicKey) return publicKey;
        try {
            const parsed = new URL(url);
            let pathname = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
            if (this.bucket && pathname.startsWith(this.bucket + '/')) {
                pathname = pathname.slice(this.bucket.length + 1);
            }
            return pathname || null;
        } catch {
            return null;
        }
    }

    private async buildApprovedUrl(destKey: string): Promise<string> {
        if (this.approvedPublicUrlBase && !this.isR2ApiStyleBaseUrl(this.approvedPublicUrlBase)) {
            return this.buildPublicUrl(this.approvedPublicUrlBase, this.approvedBucket, destKey);
        }
        return getSignedUrl(this.approvedS3Client, new GetObjectCommand({ Bucket: this.approvedBucket, Key: destKey }), { expiresIn: 604800 });
    }

    private buildApprovedKey(safeArticleNumber: string, ext: string, safeColor?: string): string {
        if (safeColor) {
            return `${safeArticleNumber}-${safeColor}.${ext}`;
        }
        return `${safeArticleNumber}.${ext}`;
    }

    private sanitizeColor(color: string): string {
        return color.trim().replace(/\s+/g, '').replace(/[^A-Za-z0-9_\-]/g, '').toUpperCase();
    }

    async uploadApprovedImageFromSourceUrl(sourceImageUrl: string, articleNumber: string, labelData?: WatermarkLabel, colorCode?: string): Promise<UploadResult> {
        if (!sourceImageUrl) {
            throw new Error('Source image URL is required');
        }
        if (!articleNumber) {
            throw new Error('Article number is required for approved image upload');
        }

        const safeArticleNumber = this.sanitizeArticleNumber(articleNumber);
        const safeColor = colorCode ? this.sanitizeColor(colorCode) : undefined;
        const wantWatermark = !!labelData;

        console.log(`[WM_DIAG] uploadApprovedImage: article=${safeArticleNumber} wantWatermark=${wantWatermark} sourceUrl="${sourceImageUrl}"`);

        // Preferred path: direct S3-to-S3 copy — no HTTP download, no network fetch needed.
        // Works for both public CDN URLs and signed R2 URLs.
        // SKIPPED when watermarking is requested — we have to touch the bytes.
        const sourceKey = this.extractKeyFromAnyUrl(sourceImageUrl);
        console.log(`[WM_DIAG] extractKeyFromAnyUrl → "${sourceKey}"`);
        if (sourceKey && !wantWatermark) {
            const extension = this.extensionFromPath(sourceKey) || 'jpg';
            const destKey = this.buildApprovedKey(safeArticleNumber, extension, safeColor);
            try {
                console.log(`📦 Direct S3 copy: ${this.bucket}/${sourceKey} → ${this.approvedBucket}/${destKey}`);
                await this.approvedS3Client.send(new CopyObjectCommand({
                    Bucket: this.approvedBucket,
                    CopySource: `${this.bucket}/${sourceKey}`,
                    Key: destKey
                }));
                console.log(`✅ Direct S3 copy succeeded: ${destKey}`);
                return { url: await this.buildApprovedUrl(destKey), path: destKey, key: destKey, uuid: safeArticleNumber };
            } catch (copyError: any) {
                console.warn(`⚠️ Direct S3 copy failed (${copyError?.message}), trying S3 GetObject fallback...`);
            }
        }

        if (sourceKey) {
            const fallbackExt = this.extensionFromPath(sourceKey) || 'jpg';
            const fallbackDestKey = this.buildApprovedKey(safeArticleNumber, fallbackExt, safeColor);
            // Second fallback (and watermark path): GetObject from source bucket → optionally watermark → PutObject.
            try {
                console.log(`[WM_DIAG] Trying S3 GetObject: bucket=${this.bucket} key=${sourceKey}`);
                const getResult = await this.s3Client.send(new GetObjectCommand({ Bucket: this.bucket, Key: sourceKey }));
                const sourceMime = getResult.ContentType || 'image/jpeg';
                const chunks: Uint8Array[] = [];
                for await (const chunk of getResult.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
                let fileBuffer: Buffer = Buffer.concat(chunks);
                let mimeType = sourceMime;
                let destKey = fallbackDestKey;

                if (wantWatermark) {
                    const stamped = await this.applyWatermarkOrPassthrough(fileBuffer, labelData!, safeArticleNumber);
                    fileBuffer = Buffer.from(stamped.buffer);
                    mimeType = stamped.mimeType;
                    destKey = this.buildApprovedKey(safeArticleNumber, stamped.extension, safeColor);
                }

                await this.putApprovedObject(this.approvedS3Client, this.approvedBucket, destKey, fileBuffer, mimeType, safeArticleNumber);
                console.log(`✅ ${wantWatermark ? 'Watermarked' : 'S3 GetObject'} upload succeeded: ${destKey}`);
                return { url: await this.buildApprovedUrl(destKey), path: destKey, key: destKey, uuid: safeArticleNumber };
            } catch (getError: any) {
                console.warn(`⚠️ S3 GetObject path failed (${getError?.message}), falling back to HTTP fetch...`);
            }
        }

        // Last resort: download via HTTP then re-upload
        let response: Response;
        try {
            response = await fetch(sourceImageUrl);
        } catch (fetchError: any) {
            throw new Error(`Failed to fetch source image (network error): ${fetchError?.message || fetchError}`);
        }
        if (!response.ok) {
            throw new Error(`Failed to fetch source image: HTTP ${response.status}`);
        }

        let mimeType = response.headers.get('content-type') || 'image/jpeg';
        let extension = this.normalizeExtension(
            this.extensionFromMimeType(mimeType)
            || this.extensionFromPath(sourceImageUrl)
            || 'jpg'
        );

        let fileBuffer: Buffer = Buffer.from(await response.arrayBuffer());

        if (wantWatermark) {
            const stamped = await this.applyWatermarkOrPassthrough(fileBuffer, labelData!, safeArticleNumber);
            fileBuffer = Buffer.from(stamped.buffer);
            mimeType = stamped.mimeType;
            extension = stamped.extension;
        }

        const key = this.buildApprovedKey(safeArticleNumber, extension, safeColor);

        try {
            try {
                await this.putApprovedObject(
                    this.approvedS3Client,
                    this.approvedBucket,
                    key,
                    fileBuffer,
                    mimeType,
                    safeArticleNumber
                );
                console.log(`✅ Approved image uploaded to ${this.approvedBucket}: ${key}`);
            } catch (primaryError: any) {
                if (!this.isAuthError(primaryError) || this.approvedS3Client === this.s3Client) {
                    throw primaryError;
                }

                console.warn(`⚠️ Approved bucket upload failed with auth error (${primaryError?.Code || primaryError?.message}). Retrying with primary R2 credentials.`);
                await this.putApprovedObject(
                    this.s3Client,
                    this.approvedBucket,
                    key,
                    fileBuffer,
                    mimeType,
                    safeArticleNumber
                );
                console.log(`✅ Approved image uploaded to ${this.approvedBucket} (via primary credentials): ${key}`);
            }

            return { url: await this.buildApprovedUrl(key), path: key, key, uuid: safeArticleNumber };
        } catch (error) {
            console.error('❌ Approved image upload failed:', error);
            throw new Error('Failed to upload approved image to storage');
        }
    }

    /**
     * Download a source garment image from the article-master (APPROVED) bucket by key.
     * Returns null when the object does not exist (404 / NoSuchKey) so callers can
     * mark the task "source not found" and continue the batch.
     */
    async fetchApprovedImage(key: string): Promise<{ buffer: Buffer; mime: string } | null> {
        try {
            const res = await this.approvedS3Client.send(
                new GetObjectCommand({ Bucket: this.approvedBucket, Key: key })
            );
            const chunks: Uint8Array[] = [];
            for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
            return { buffer: Buffer.concat(chunks), mime: res.ContentType || 'image/jpeg' };
        } catch (error: any) {
            const code = String(error?.Code || error?.code || error?.name || '').toLowerCase();
            const status = Number(error?.$metadata?.httpStatusCode || 0);
            if (code === 'nosuchkey' || code === 'notfound' || status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Upload a generated model image to the model-images bucket at the given key
     * (e.g. "1110097922-BLACK/front.jpg"). Returns the public URL when a public
     * base is configured, otherwise a 7-day signed URL.
     */
    /**
     * List objects in the model-images bucket (for the gallery browser). Returns a
     * page of image objects with public URLs, plus a cursor for the next page.
     * `prefix` filters by key prefix (e.g. an article number).
     *
     * When `from`/`to` (ISO instants) are supplied, objects are filtered by their
     * LastModified timestamp. S3/R2 has no server-side date filter and lists keys
     * lexicographically, not chronologically — a given day's uploads are scattered
     * across every page — so a date filter must scan the whole listing rather than
     * one page. Scanning is capped by MAX_DATE_SCAN_PAGES; the caller is told via
     * `scanTruncated` when the cap was hit so it can warn instead of silently
     * under-reporting. Signed URLs are only minted for objects that survive the
     * filter, so a wide scan does not cost a signature per skipped object.
     */
    async listModelImages(opts: { prefix?: string; cursor?: string; limit?: number; from?: string; to?: string } = {}): Promise<{
        objects: Array<{ key: string; url: string; size?: number; lastModified?: string }>;
        nextCursor?: string;
        scanTruncated?: boolean;
    }> {
        const base = this.modelImagesPublicUrlBase?.replace(/\/$/, '');
        const isImageKey = (k?: string) => !!k && /\.(png|jpe?g|webp)$/i.test(k);
        const toUrl = async (o: { Key?: string; Size?: number; LastModified?: Date }) => {
            const key = o.Key!;
            const url = base
                ? `${base}/${key}`
                : await getSignedUrl(this.modelImagesS3Client, new GetObjectCommand({ Bucket: this.modelImagesBucket, Key: key }), { expiresIn: 3600 });
            return { key, url, size: o.Size, lastModified: o.LastModified?.toISOString() };
        };

        const fromMs = opts.from ? Date.parse(opts.from) : NaN;
        const toMs = opts.to ? Date.parse(opts.to) : NaN;
        const hasDateFilter = Number.isFinite(fromMs) || Number.isFinite(toMs);

        if (!hasDateFilter) {
            const res = await this.modelImagesS3Client.send(new ListObjectsV2Command({
                Bucket: this.modelImagesBucket,
                Prefix: opts.prefix ? opts.prefix : undefined,
                MaxKeys: Math.min(Math.max(opts.limit ?? 200, 1), 1000),
                ContinuationToken: opts.cursor || undefined,
            }));
            const contents = (res.Contents || []).filter((o) => isImageKey(o.Key));
            const objects = await Promise.all(contents.map(toUrl));
            return { objects, nextCursor: res.IsTruncated ? res.NextContinuationToken : undefined };
        }

        const MAX_DATE_SCAN_PAGES = 50; // 50 × 1000 keys — far above the current bucket size
        const matches: Array<{ Key?: string; Size?: number; LastModified?: Date }> = [];
        let token: string | undefined = opts.cursor || undefined;
        let pages = 0;
        let scanTruncated = false;

        do {
            const page: ListObjectsV2CommandOutput = await this.modelImagesS3Client.send(new ListObjectsV2Command({
                Bucket: this.modelImagesBucket,
                Prefix: opts.prefix ? opts.prefix : undefined,
                MaxKeys: 1000,
                ContinuationToken: token,
            }));
            pages++;
            for (const o of page.Contents || []) {
                if (!isImageKey(o.Key) || !o.LastModified) continue;
                const t = o.LastModified.getTime();
                if (Number.isFinite(fromMs) && t < fromMs) continue;
                if (Number.isFinite(toMs) && t >= toMs) continue;
                matches.push(o);
            }
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
            if (token && pages >= MAX_DATE_SCAN_PAGES) {
                scanTruncated = true;
                break;
            }
        } while (token);

        // Newest first — within a date filter, recency is the useful ordering.
        matches.sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));
        const objects = await Promise.all(matches.map(toUrl));
        return { objects, scanTruncated };
    }

    /** Download a model-image object by key (for the server-side download proxy). */
    async fetchModelImage(key: string): Promise<{ buffer: Buffer; mime: string } | null> {
        try {
            const res = await this.modelImagesS3Client.send(
                new GetObjectCommand({ Bucket: this.modelImagesBucket, Key: key })
            );
            const chunks: Uint8Array[] = [];
            for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
            return { buffer: Buffer.concat(chunks), mime: res.ContentType || 'image/jpeg' };
        } catch (error: any) {
            const code = String(error?.Code || error?.code || error?.name || '').toLowerCase();
            const status = Number(error?.$metadata?.httpStatusCode || 0);
            if (code === 'nosuchkey' || code === 'notfound' || status === 404) return null;
            throw error;
        }
    }

    async uploadModelImage(key: string, buffer: Buffer, mime = 'image/jpeg'): Promise<string> {
        try {
            await this.modelImagesS3Client.send(new PutObjectCommand({
                Bucket: this.modelImagesBucket,
                Key: key,
                Body: buffer,
                ContentType: mime,
            }));
            console.log(`✅ Uploaded model image to ${this.modelImagesBucket}: ${key}`);
        } catch (error) {
            console.error('❌ Model image upload failed:', error);
            throw error;
        }
        if (this.modelImagesPublicUrlBase) {
            return this.buildPublicUrl(this.modelImagesPublicUrlBase, this.modelImagesBucket, key);
        }
        return getSignedUrl(
            this.modelImagesS3Client,
            new GetObjectCommand({ Bucket: this.modelImagesBucket, Key: key }),
            { expiresIn: 604800 }
        );
    }

    /**
     * Server-side copy of one object within the model-images bucket (e.g. promoting a
     * generated view into the E-commerce/ folder). No download/re-upload — R2 copies
     * the bytes internally. CopySource must be URL-encoded per path segment because
     * article-number keys can contain spaces (e.g. "1110106859-DARK GREY/front.jpg").
     */
    async copyModelImage(sourceKey: string, destKey: string): Promise<string> {
        const encodedSource = sourceKey.split('/').map(encodeURIComponent).join('/');
        await this.modelImagesS3Client.send(new CopyObjectCommand({
            Bucket: this.modelImagesBucket,
            CopySource: `${this.modelImagesBucket}/${encodedSource}`,
            Key: destKey,
        }));
        console.log(`✅ Copied model image: ${sourceKey} → ${destKey}`);
        if (this.modelImagesPublicUrlBase) {
            return this.buildPublicUrl(this.modelImagesPublicUrlBase, this.modelImagesBucket, destKey);
        }
        return getSignedUrl(
            this.modelImagesS3Client,
            new GetObjectCommand({ Bucket: this.modelImagesBucket, Key: destKey }),
            { expiresIn: 604800 }
        );
    }

    /**
     * Delete every object under a prefix in the model-images bucket. Used to pull an
     * article's promoted copies back out of E-commerce/ when an approval is reverted or
     * the article is rejected — leaving them behind would keep a withdrawn article live
     * on the storefront. Returns how many objects were removed.
     */
    async deleteModelImagePrefix(prefix: string): Promise<number> {
        if (!prefix || prefix.includes('..')) throw new Error('A valid prefix is required');
        let token: string | undefined;
        let deleted = 0;

        do {
            const page: ListObjectsV2CommandOutput = await this.modelImagesS3Client.send(new ListObjectsV2Command({
                Bucket: this.modelImagesBucket,
                Prefix: prefix,
                MaxKeys: 1000,
                ContinuationToken: token,
            }));
            const keys = (page.Contents || []).map((o) => o.Key).filter((k): k is string => !!k);
            if (keys.length) {
                await this.modelImagesS3Client.send(new DeleteObjectsCommand({
                    Bucket: this.modelImagesBucket,
                    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
                }));
                deleted += keys.length;
            }
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);

        if (deleted) console.log(`🗑️  Deleted ${deleted} model image(s) under ${prefix}`);
        return deleted;
    }
}

export const storageService = new StorageService();
