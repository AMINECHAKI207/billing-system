import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';

const RECEIPT_DIR = 'expense-receipts';
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.min(env.MAX_FILE_SIZE_MB, 10) * 1024 * 1024 || MAX_RECEIPT_SIZE },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
      callback(ApiError.badRequest('Invalid receipt format. Use PDF, PNG, JPG or JPEG.'));
      return;
    }

    callback(null, true);
  },
});

export function uploadReceiptField(fieldName = 'receipt') {
  const middleware = receiptUpload.single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(ApiError.badRequest('Receipt is too large. Maximum size is 10 MB.'));
        return;
      }

      next(error);
    });
  };
}

export async function saveReceipt(file: Express.Multer.File) {
  validateReceipt(file);

  const extension = path.extname(file.originalname).toLowerCase();
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const uploadsRoot = getUploadsRoot();
  const receiptDir = path.join(uploadsRoot, RECEIPT_DIR, yyyy, mm);
  await fs.promises.mkdir(receiptDir, { recursive: true });

  const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(receiptDir, fileName);
  assertInside(absolutePath, receiptDir);
  await fs.promises.writeFile(absolutePath, file.buffer, { flag: 'wx' });

  const storageKey = `${RECEIPT_DIR}/${yyyy}/${mm}/${fileName}`;
  return {
    fileName,
    storageKey,
    fileUrl: `/uploads/${storageKey}`,
    buffer: file.buffer,
  };
}

export function resolveReceiptStorageKey(storageKey: string) {
  if (!storageKey.startsWith(`${RECEIPT_DIR}/`)) {
    throw ApiError.badRequest('Invalid receipt reference.');
  }

  const safeParts = storageKey.split('/').map((part) => path.basename(part));
  if (safeParts.join('/') !== storageKey) {
    throw ApiError.badRequest('Invalid receipt reference.');
  }

  const absolutePath = path.join(getUploadsRoot(), ...safeParts);
  assertInside(absolutePath, path.join(getUploadsRoot(), RECEIPT_DIR));
  return absolutePath;
}

function validateReceipt(file?: Express.Multer.File) {
  if (!file) {
    throw ApiError.badRequest('Receipt file is required.');
  }

  const extension = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
    throw ApiError.badRequest('Invalid receipt format. Use PDF, PNG, JPG or JPEG.');
  }

  if (file.size > MAX_RECEIPT_SIZE) {
    throw ApiError.badRequest('Receipt is too large. Maximum size is 10 MB.');
  }

  if (!hasExpectedSignature(file.buffer, file.mimetype)) {
    throw ApiError.badRequest('Receipt file is invalid or corrupted.');
  }
}

function hasExpectedSignature(buffer: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') {
    return buffer.length > 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }

  if (mimeType === 'image/jpeg') {
    return buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8;
  }

  if (mimeType === 'image/png') {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return buffer.length >= signature.length && buffer.subarray(0, 8).equals(signature);
  }

  return false;
}

function getUploadsRoot() {
  return path.resolve(process.cwd(), env.UPLOADS_DIR);
}

function assertInside(targetPath: string, parentPath: string) {
  const relative = path.relative(parentPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw ApiError.badRequest('Invalid file path.');
  }
}
