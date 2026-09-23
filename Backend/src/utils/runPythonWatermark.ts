import { spawn } from 'child_process';
import path from 'path';

// Resolve the Python binary once. Override with PYTHON_BIN if your system uses
// "python3" or a venv path. On Windows the "py" launcher also works.
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
// Hard cap so a stuck Python process can never block the SRM cron forever.
const WATERMARK_TIMEOUT_MS = parseInt(process.env.WATERMARK_TIMEOUT_MS || '15000', 10);
const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'watermark.py');

export type WatermarkFormat = 'png' | 'jpeg';

export interface WatermarkOptions {
  /** Output encoding. PNG = lossless (large, default for SRM/VLM input);
   *  JPEG = smaller (recommended for catalog/bucket uploads). */
  format?: WatermarkFormat;
}

export interface WatermarkResult {
  success: boolean;
  buffer?: Buffer;
  error?: string;
  durationMs: number;
  /** Mime type matching the output buffer — useful for S3 ContentType. */
  mimeType?: string;
}

/**
 * Pipe an image through the Python watermarking script.
 *
 * Contract:
 *   - image bytes go to Python's stdin
 *   - `row` is JSON-stringified and passed via `--data`
 *   - format is passed via `--format` (default 'png')
 *   - watermarked image bytes come back via Python's stdout
 *   - any stderr / non-zero exit is captured into `error`
 *
 * Callers must treat failure as soft — fall back to the original image / URL.
 */
export async function runPythonWatermark(
  imageBuffer: Buffer,
  row: Record<string, unknown>,
  options: WatermarkOptions = {},
): Promise<WatermarkResult> {
  const start = Date.now();
  const format: WatermarkFormat = options.format ?? 'png';
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

  return new Promise<WatermarkResult>(resolve => {
    let settled = false;
    const finish = (r: WatermarkResult) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, durationMs: Date.now() - start });
    };

    let py;
    try {
      py = spawn(
        PYTHON_BIN,
        [SCRIPT_PATH, '--data', JSON.stringify(row), '--format', format],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
    } catch (err: any) {
      finish({ success: false, error: `Failed to spawn ${PYTHON_BIN}: ${err?.message ?? err}`, durationMs: 0 });
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;

    py.stdout.on('data', (chunk: Buffer) => {
      outChunks.push(chunk);
      outBytes += chunk.length;
    });
    py.stderr.on('data', (chunk: Buffer) => {
      errChunks.push(chunk);
    });

    py.on('error', err => {
      finish({ success: false, error: `Python process error: ${err?.message ?? err}`, durationMs: 0 });
    });

    const timer = setTimeout(() => {
      try { py.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ success: false, error: `Watermark timed out after ${WATERMARK_TIMEOUT_MS}ms`, durationMs: 0 });
    }, WATERMARK_TIMEOUT_MS);

    py.on('close', (code: number | null) => {
      clearTimeout(timer);
      const errText = Buffer.concat(errChunks).toString().trim();
      if (errText) console.log(`[watermark stderr] ${errText}`);
      if (code === 0 && outBytes > 0) {
        finish({ success: true, buffer: Buffer.concat(outChunks), mimeType, durationMs: 0 });
        return;
      }
      finish({
        success: false,
        error: errText || `Python exited with code ${code} and no output`,
        durationMs: 0,
      });
    });

    // Send the image bytes on stdin and close the stream.
    py.stdin.on('error', err => {
      // EPIPE here means Python exited before we finished writing — the close
      // handler above will produce the real error message.
      if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
        console.warn('[watermark] stdin write error:', err.message);
      }
    });
    py.stdin.end(imageBuffer);
  });
}
