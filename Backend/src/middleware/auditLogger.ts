/**
 * 📊 Audit Logging Middleware
 * Tracks all API requests for security and compliance
 */

import { Request, Response, NextFunction } from 'express';
import { prismaClient as prisma } from '../utils/prisma';

const ENABLE_AUDIT_LOGGING = process.env.ENABLE_AUDIT_LOGGING !== 'false';
const AUDIT_LOG_BATCH_SIZE = Number.parseInt(process.env.AUDIT_LOG_BATCH_SIZE || '10');

// In-memory batch for performance
let auditBatch: any[] = [];
let batchTimeout: NodeJS.Timeout | null = null;
// Runtime flag: if the audit logs table is missing or DB disallows writes, disable further attempts
let auditLoggingAvailable = true;

interface AuditLogEntry {
  userId: number | null;
  action: string;
  resource: string;
  resourceId: string | null;
  method: string;
  path: string;
  statusCode: number;
  ip: string;
  userAgent: string | null;
  requestBody: any;
  responseBody: any;
  duration: number;
  errorMessage: string | null;
  timestamp: Date;
}

/**
 * Audit log middleware
 * Captures request/response details and logs to database
 */
export const auditLog = (req: Request, res: Response, next: NextFunction): void => {
  // Skip if disabled
  if (!ENABLE_AUDIT_LOGGING || !auditLoggingAvailable) {
    next();
    return;
  }

  // Skip health check and info endpoints
  if (shouldSkipAudit(req.path)) {
    next();
    return;
  }

  const startTime = Date.now();

  // Store original res.json
  const originalJson = res.json.bind(res);

  // Override res.json to capture response
  res.json = function (body: any) {
    const duration = Date.now() - startTime;

    // For list responses (arrays or {data:[]}), skip storing the full body to avoid
    // holding megabytes of article data in memory for the 5s batch window.
    const isLargeListResponse = Array.isArray(body) ||
      (body && Array.isArray(body.data) && body.data.length > 5) ||
      (body && Array.isArray(body.items) && body.items.length > 5);

    // Create audit log entry
    const logEntry: AuditLogEntry = {
      userId: req.user?.id || null,
      action: getAction(req.method),
      resource: getResource(req.path),
      resourceId: getResourceId(req.path),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      requestBody: sanitizeBody(req.body),
      responseBody: isLargeListResponse ? null : sanitizeBody(body),
      duration,
      errorMessage: res.statusCode >= 400 ? body?.error || null : null,
      timestamp: new Date(),
    };

    // Add to batch
    addToBatch(logEntry);

    return originalJson(body);
  };

  next();
};

/**
 * Add log entry to batch and flush if needed
 */
function addToBatch(logEntry: AuditLogEntry): void {
  auditBatch.push(logEntry);

  // Flush if batch is full
  if (auditBatch.length >= AUDIT_LOG_BATCH_SIZE) {
    flushBatch();
  } else {
    // Schedule flush after 5 seconds
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }
    batchTimeout = setTimeout(() => { void flushBatch().catch((err: any) => console.error('[AuditLog] flush failed:', err?.message)); }, 5000);
  }
}

/**
 * Flush batch to database
 */
async function flushBatch(): Promise<void> {
  if (auditBatch.length === 0) return;

  const batch = [...auditBatch];
  auditBatch = [];

  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }

  try {
    // Use createMany for better performance
    await prisma.auditLog.createMany({
      data: batch,
      skipDuplicates: true,
    });

    console.log(`✅ Flushed ${batch.length} audit log entries`);
  } catch (error) {
    // Handle database connection errors
    const errorCode = (error as any)?.code;
    const errorMessage = (error as any)?.message || '';
    
    // P2021: table doesn't exist, P1017: server connection closed, P1001: can't reach database
    // P2024: connection pool timeout
    if (errorCode === 'P2021' || errorMessage.includes('does not exist')) {
      console.warn('⚠️ Audit logging disabled: audit_logs table is missing in the database.');
      auditLoggingAvailable = false;
    } else if (errorCode === 'P1017' || errorMessage.includes('closed the connection')) {
      console.warn('⚠️ Database connection closed, will retry audit logging on next batch');
      // Don't disable completely, connection might recover
    } else if (errorCode === 'P2024' || errorMessage.includes('connection pool')) {
      console.warn('⚠️ Connection pool timeout, will retry on next batch');
      // Connection pool exhausted, but might recover
    } else {
      console.error('❌ Failed to flush audit logs:', error);
    }
    
    // Don't re-add to batch to avoid infinite loop
  }
}

/**
 * Graceful shutdown handler
 */
export async function flushAuditLogsOnShutdown(): Promise<void> {
  console.log('🔄 Flushing remaining audit logs...');
  if (auditLoggingAvailable) {
    await flushBatch();
  } else {
    console.log('⚠️ Audit logging disabled; skipping flush on shutdown');
  }
  console.log('✅ Audit logs flushed');
}

/**
 * Determine action based on HTTP method
 */
function getAction(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'READ';
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Extract resource name from path
 */
function getResource(path: string): string {
  const parts = path.split('/').filter((p) => p && !(/^\d+$/).exec(p));
  
  // Remove 'api' from parts
  const filtered = parts.filter(p => p !== 'api');
  
  // Return last meaningful part
  return filtered[filtered.length - 1] || 'unknown';
}

/**
 * Extract resource ID from path
 */
function getResourceId(path: string): string | null {
  // Match numeric IDs or UUIDs
  const match = (/\/(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i).exec(path);
  return match ? match[1] : null;
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  
  if (forwarded) {
    const ips = (forwarded as string).split(',');
    return ips[0].trim();
  }
  
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Sanitize a request/response body into a plain, JSON-safe value before it is
 * written to the auditLog Json column.
 *
 * This MUST NOT recurse blindly into arbitrary objects. Doing so froze the whole
 * backend: a Buffer (walked as thousands of numeric byte keys), a Prisma Decimal
 * (walked into decimal.js internals), or a circular reference turned this into an
 * enormous/looping structure that then hung Prisma's own serializer (100% CPU,
 * blocked event loop, every request stuck on "Starting…"). So we guard every
 * dangerous shape explicitly and bound depth, breadth, and cycles.
 */
const SANITIZE_MAX_DEPTH = 8;
const SANITIZE_MAX_ARRAY = 100;

function sanitizeBody(body: any, seen: WeakSet<object> = new WeakSet(), depth = 0): any {
  if (body === null || body === undefined) return null;

  const t = typeof body;
  if (t === 'string') return body.length > 1000 ? `[TRUNCATED: ${body.length} chars]` : body;
  if (t === 'number' || t === 'boolean') return body;
  if (t === 'bigint') return body.toString();
  if (t === 'function' || t === 'symbol') return undefined;
  if (t !== 'object') return body;

  // Binary / typed data — never walk byte-by-byte.
  if (Buffer.isBuffer(body)) return `[Buffer: ${body.length} bytes]`;
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) {
    return `[${(body as any).constructor?.name || 'Binary'}: ${(body as any).byteLength ?? (body as any).length} bytes]`;
  }
  if (body instanceof Date) return body.toISOString();

  if (depth >= SANITIZE_MAX_DEPTH) return '[max depth]';
  if (seen.has(body)) return '[Circular]';
  seen.add(body);

  if (Array.isArray(body)) {
    const out = body.slice(0, SANITIZE_MAX_ARRAY).map((v) => sanitizeBody(v, seen, depth + 1));
    if (body.length > SANITIZE_MAX_ARRAY) out.push(`[+${body.length - SANITIZE_MAX_ARRAY} more items]`);
    return out;
  }

  // Class instances (Prisma Decimal, streams, etc.) are not plain objects — do NOT
  // walk their internals; represent them by their string form instead.
  const proto = Object.getPrototypeOf(body);
  if (proto !== Object.prototype && proto !== null) {
    try { return String(body); } catch { return '[unserializable object]'; }
  }

  const sanitized: any = {};
  for (const key in body) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    sanitized[key] = isSensitiveField(key) ? '[REDACTED]' : sanitizeBody(body[key], seen, depth + 1);
  }
  return sanitized;
}

/**
 * Check if field is sensitive
 */
function isSensitiveField(fieldName: string): boolean {
  const sensitiveFields = [
    'password',
    'token',
    'apiKey',
    'api_key',
    'secret',
    'authorization',
    'creditCard',
    'ssn',
    'cvv',
  ];

  return sensitiveFields.some((field) =>
    fieldName.toLowerCase().includes(field.toLowerCase())
  );
}

/**
 * Check if path should skip audit logging
 */
function shouldSkipAudit(path: string): boolean {
  const skipPaths = [
    '/',
    '/api/health',
    '/api/public/health',
    '/api/vlm/health',
    '/api/vlm/info',
    '/api/public/vlm/info',
  ];

  return skipPaths.includes(path);
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(filters: {
  userId?: number;
  action?: string;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  statusCode?: number;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};

  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.resource) where.resource = filters.resource;
  if (filters.statusCode) where.statusCode = filters.statusCode;

  if (filters.startDate || filters.endDate) {
    where.timestamp = {};
    if (filters.startDate) where.timestamp.gte = filters.startDate;
    if (filters.endDate) where.timestamp.lte = filters.endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: filters.limit || 100,
      skip: filters.offset || 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    total,
    page: Math.floor((filters.offset || 0) / (filters.limit || 100)) + 1,
    totalPages: Math.ceil(total / (filters.limit || 100)),
  };
}

/**
 * Get audit log statistics
 */
export async function getAuditLogStats(filters?: {
  startDate?: Date;
  endDate?: Date;
}) {
  const where: any = {};

  if (filters?.startDate || filters?.endDate) {
    where.timestamp = {};
    if (filters.startDate) where.timestamp.gte = filters.startDate;
    if (filters.endDate) where.timestamp.lte = filters.endDate;
  }

  const [totalLogs, actionStats, resourceStats, statusCodeStats] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { action: true },
    }),
    prisma.auditLog.groupBy({
      by: ['resource'],
      where,
      _count: { resource: true },
      orderBy: { _count: { resource: 'desc' } },
      take: 10,
    }),
    prisma.auditLog.groupBy({
      by: ['statusCode'],
      where,
      _count: { statusCode: true },
    }),
  ]);

  return {
    totalLogs,
    actionStats,
    resourceStats,
    statusCodeStats,
  };
}
