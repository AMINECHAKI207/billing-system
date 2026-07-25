import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import zlib from 'zlib';
import { Request, Response, NextFunction } from 'express';
import { env } from '@config/env';
import { removeImageBackground } from '@services/backgroundRemoval.service';
import { ApiError } from '@utils/ApiError';

const MAX_COMPANY_ASSET_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const COMPANY_ASSET_DIR = 'company-assets';

export type CompanyAssetKind = 'signature' | 'stamp';

export const companyAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COMPANY_ASSET_SIZE },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
      callback(ApiError.badRequest('Format invalide. Utilisez une image PNG, JPG ou JPEG.'));
      return;
    }

    callback(null, true);
  },
});

export function uploadCompanyAssetField(fieldName = 'file') {
  const middleware = companyAssetUpload.single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(ApiError.badRequest('Image trop volumineuse. Taille maximale: 2 Mo.'));
        return;
      }

      next(error);
    });
  };
}

export async function saveCompanyAsset(file: Express.Multer.File, kind: CompanyAssetKind) {
  validateCompanyAsset(file);

  const uploadsRoot = getUploadsRoot();
  const assetDir = path.join(uploadsRoot, COMPANY_ASSET_DIR);
  await fs.promises.mkdir(assetDir, { recursive: true });

  const extension = path.extname(file.originalname).toLowerCase();
  const fileName = `${kind}-${Date.now()}-${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(assetDir, fileName);

  assertInside(absolutePath, assetDir);
  await fs.promises.writeFile(absolutePath, file.buffer, { flag: 'wx' });

  return `/uploads/${COMPANY_ASSET_DIR}/${fileName}`;
}

export async function removeCompanyAssetBackground(assetUrl: string | null | undefined, kind: CompanyAssetKind) {
  const sourcePath = resolveCompanyAssetUrl(assetUrl);
  if (!sourcePath) {
    throw ApiError.badRequest('Aucune image a traiter.');
  }

  const uploadsRoot = getUploadsRoot();
  const assetDir = path.join(uploadsRoot, COMPANY_ASSET_DIR);
  await fs.promises.mkdir(assetDir, { recursive: true });

  const sourceBuffer = await fs.promises.readFile(sourcePath);
  const sourceExtension = path.extname(sourcePath).toLowerCase();
  const processedAsset = await removeImageBackground({
    buffer: sourceBuffer,
    fileName: path.basename(sourcePath),
    mimeType: sourceExtension === '.jpg' || sourceExtension === '.jpeg' ? 'image/jpeg' : 'image/png',
  });
  const fileName = `${kind}-${Date.now()}-${crypto.randomUUID()}.png`;
  const absolutePath = path.join(assetDir, fileName);

  assertInside(absolutePath, assetDir);
  await fs.promises.writeFile(absolutePath, processedAsset, { flag: 'wx' });

  return `/uploads/${COMPANY_ASSET_DIR}/${fileName}`;
}

export async function processCompanyAssetBackground(file?: Express.Multer.File) {
  validateCompanyAsset(file);
  if (!file) {
    throw ApiError.badRequest('Image manquante.');
  }

  return removeImageBackground({
    buffer: file.buffer,
    fileName: file.originalname,
    mimeType: file.mimetype,
  });
}

export async function removeCompanyAsset(assetUrl?: string | null) {
  const absolutePath = resolveCompanyAssetUrl(assetUrl);
  if (!absolutePath) return;

  try {
    await fs.promises.unlink(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function resolveCompanyAssetUrl(assetUrl?: string | null) {
  if (!assetUrl) return null;

  const expectedPrefix = `/uploads/${COMPANY_ASSET_DIR}/`;
  if (!assetUrl.startsWith(expectedPrefix)) return null;

  const fileName = path.basename(assetUrl);
  if (fileName !== assetUrl.slice(expectedPrefix.length)) return null;

  const assetDir = path.join(getUploadsRoot(), COMPANY_ASSET_DIR);
  const absolutePath = path.join(assetDir, fileName);
  assertInside(absolutePath, assetDir);

  return absolutePath;
}

function validateCompanyAsset(file?: Express.Multer.File) {
  if (!file) {
    throw ApiError.badRequest('Image manquante.');
  }

  const extension = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
    throw ApiError.badRequest('Format invalide. Utilisez une image PNG, JPG ou JPEG.');
  }

  if (file.size > MAX_COMPANY_ASSET_SIZE) {
    throw ApiError.badRequest('Image trop volumineuse. Taille maximale: 2 Mo.');
  }

  if (!hasValidImageContent(file.buffer, file.mimetype)) {
    throw ApiError.badRequest('Image invalide ou corrompue.');
  }
}

function getUploadsRoot() {
  return path.resolve(process.cwd(), env.UPLOADS_DIR);
}

function assertInside(targetPath: string, parentPath: string) {
  const relative = path.relative(parentPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw ApiError.badRequest('Chemin de fichier invalide.');
  }
}

function hasValidImageContent(buffer: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg') {
    return (
      buffer.length > 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[buffer.length - 2] === 0xff &&
      buffer[buffer.length - 1] === 0xd9
    );
  }

  if (mimeType !== 'image/png') return false;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) return false;

  let offset = 8;
  const idatChunks: Buffer[] = [];
  let hasIhdr = false;
  let hasIend = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;

    if (dataEnd > buffer.length || nextOffset > buffer.length) return false;
    if (type === 'IHDR') hasIhdr = length === 13;
    if (type === 'IDAT') idatChunks.push(buffer.subarray(dataStart, dataEnd));
    if (type === 'IEND') {
      hasIend = true;
      break;
    }

    offset = nextOffset;
  }

  if (!hasIhdr || !hasIend || idatChunks.length === 0) return false;

  try {
    zlib.inflateSync(Buffer.concat(idatChunks));
    return true;
  } catch {
    return false;
  }
}
