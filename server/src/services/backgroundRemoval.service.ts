import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';

type BackgroundRemovalInput = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

type WorkerResponse = {
  id?: string | null;
  ok?: boolean;
  imageBase64?: string;
  error?: string;
  trace?: string;
  event?: 'ready' | 'fatal';
  model?: string;
  device?: string;
};

type PendingRequest = {
  resolve: (buffer: Buffer) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type SharpFactory = typeof import('sharp').default;

let sharpFactory: SharpFactory | null = null;

class BackgroundRemovalWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private stderr = '';
  private ready = false;

  async process(input: BackgroundRemovalInput) {
    const child = this.ensureStarted();
    const id = crypto.randomUUID();

    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Delai depasse apres ${env.AI_BACKGROUND_REMOVAL_TIMEOUT_MS} ms.`));
      }, env.AI_BACKGROUND_REMOVAL_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(
        `${JSON.stringify({
          id,
          fileName: input.fileName,
          mimeType: input.mimeType,
          imageBase64: input.buffer.toString('base64'),
        })}\n`,
        (error) => {
          if (!error) return;
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(error);
        }
      );
    });
  }

  private ensureStarted() {
    if (this.child && !this.child.killed) return this.child;

    const scriptPath = resolveWorkerScriptPath();
    this.ready = false;
    this.stderr = '';

    this.child = spawn(
      env.AI_BACKGROUND_REMOVAL_PYTHON,
      [
        scriptPath,
        '--model',
        env.AI_BACKGROUND_REMOVAL_MODEL,
        '--image-size',
        String(env.AI_BACKGROUND_REMOVAL_IMAGE_SIZE),
      ],
      {
        cwd: resolveServerRoot(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const output = readline.createInterface({ input: this.child.stdout });
    output.on('line', (line) => this.handleWorkerLine(line));

    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-4000);
    });

    this.child.on('error', (error) => this.rejectAll(error));
    this.child.on('exit', (code, signal) => {
      const details = this.stderr.trim();
      this.rejectAll(
        new Error(
          `Worker IA arrete (${signal ?? code ?? 'inconnu'}).${details ? ` ${details}` : ''}`
        )
      );
      this.child = null;
      this.ready = false;
    });

    return this.child;
  }

  private handleWorkerLine(line: string) {
    let message: WorkerResponse;
    try {
      message = JSON.parse(line) as WorkerResponse;
    } catch {
      this.stderr = `${this.stderr}${line}\n`.slice(-4000);
      return;
    }

    if (message.event === 'ready') {
      this.ready = true;
      return;
    }

    if (message.event === 'fatal') {
      this.rejectAll(new Error(message.error || 'Le modele IA local ne peut pas etre charge.'));
      this.child?.kill();
      return;
    }

    if (!message.id) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if (!message.ok || !message.imageBase64) {
      pending.reject(new Error(message.error || 'La suppression de fond IA a echoue.'));
      return;
    }

    pending.resolve(Buffer.from(message.imageBase64, 'base64'));
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  shutdown() {
    if (!this.child) return;
    this.child.kill();
    this.child = null;
    this.ready = false;
  }
}

const worker = new BackgroundRemovalWorker();

export async function removeImageBackground(input: BackgroundRemovalInput) {
  try {
    const output = await worker.process(input);
    return optimizeTransparentPng(output);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    try {
      return await removeBackgroundFallback(input.buffer);
    } catch (fallbackError) {
      throw ApiError.badRequest(
        `Impossible de supprimer le fond avec le modele IA local. ${(error as Error).message}. ` +
          `Solution de secours indisponible: ${(fallbackError as Error).message}`
      );
    }
  }
}

export function shutdownBackgroundRemovalWorker() {
  worker.shutdown();
}

async function optimizeTransparentPng(buffer: Buffer) {
  try {
    const sharp = await getSharp();
    const metadata = await sharp(buffer).metadata();
    if (!metadata.hasAlpha) {
      throw new Error('Le modele IA local n a pas retourne de transparence.');
    }

    return sharp(buffer)
      .rotate()
      .ensureAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();
  } catch (error) {
    throw new Error(`PNG transparent invalide: ${(error as Error).message}`);
  }
}

async function removeBackgroundFallback(buffer: Buffer) {
  const sharp = await getSharp();
  const { data, info } = await sharp(buffer)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.from(data);
  for (let index = 0; index < output.length; index += info.channels) {
    const red = output[index] ?? 255;
    const green = output[index + 1] ?? 255;
    const blue = output[index + 2] ?? 255;
    const alpha = output[index + 3] ?? 255;
    const distanceFromWhite = Math.sqrt(
      (255 - red) ** 2 + (255 - green) ** 2 + (255 - blue) ** 2
    );
    const computedAlpha = Math.max(0, Math.min(255, Math.round((distanceFromWhite - 12) * 9)));
    output[index + 3] = Math.min(alpha, computedAlpha);
  }

  return sharp(output, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}

async function getSharp() {
  if (!sharpFactory) {
    sharpFactory = (await import('sharp')).default;
  }

  return sharpFactory;
}

function resolveWorkerScriptPath() {
  const candidates = [
    path.resolve(resolveServerRoot(), 'scripts', 'birefnet-background-worker.py'),
    path.resolve(process.cwd(), 'server', 'scripts', 'birefnet-background-worker.py'),
    path.resolve(__dirname, '..', '..', 'scripts', 'birefnet-background-worker.py'),
  ];

  const scriptPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!scriptPath) {
    throw new Error('Script local BiRefNet introuvable.');
  }

  return scriptPath;
}

function resolveServerRoot() {
  if (fs.existsSync(path.resolve(process.cwd(), 'src', 'app.ts'))) {
    return process.cwd();
  }

  if (fs.existsSync(path.resolve(process.cwd(), 'server', 'src', 'app.ts'))) {
    return path.resolve(process.cwd(), 'server');
  }

  return path.resolve(__dirname, '..', '..');
}
