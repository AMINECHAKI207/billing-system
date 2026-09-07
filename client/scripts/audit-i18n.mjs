import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

const rootDir = process.cwd();
const localeDirArgIndex = process.argv.indexOf('--locale-dir');
const localeDir = localeDirArgIndex >= 0
  ? path.resolve(rootDir, process.argv[localeDirArgIndex + 1])
  : path.resolve(rootDir, 'src', 'i18n', 'locales');
const telegramFileArgIndex = process.argv.indexOf('--telegram-file');
const telegramFilePath = telegramFileArgIndex >= 0
  ? path.resolve(rootDir, process.argv[telegramFileArgIndex + 1])
  : path.resolve(rootDir, '..', 'server', 'src', 'modules', 'telegram', 'telegram.service.ts');
const skipIndexCheck = process.argv.includes('--skip-index');
const languages = ['en', 'fr', 'ar'];
const requiredStatusNamespaces = [
  'expenses.status.workflow',
  'expenses.audit',
  'creditNotes.status',
  'creditNotes.actions',
  'creditNotes.messages',
];
const rawEnumLabels = [
  'PAID',
  'REJECTED',
  'APPROVED',
  'SUBMITTED',
  'PROCESSING',
  'DRAFT',
  'VALIDATED',
  'CANCELLED',
  'REFUNDED',
];

const failures = [];
const localeMaps = new Map();

for (const language of languages) {
  const filePath = path.join(localeDir, `${language}.json`);
  const source = readUtf8File(filePath, `${language}: locale file`);
  if (!source) continue;

  const duplicateKeys = findDuplicateKeys(source);
  for (const key of duplicateKeys) {
    failures.push(`${language}: duplicate key ${key}`);
  }

  try {
    const parsed = JSON.parse(source);
    const flattened = flatten(parsed);
    localeMaps.set(language, flattened);

    for (const [key, value] of Object.entries(flattened)) {
      validateKey(language, key);
      validateValue(language, key, value);
    }
  } catch (error) {
    failures.push(`${language}: invalid JSON (${error.message})`);
  }
}

const allKeys = new Set([...localeMaps.values()].flatMap((map) => Object.keys(map)));
for (const language of languages) {
  const map = localeMaps.get(language) ?? {};
  for (const key of allKeys) {
    if (!(key in map)) failures.push(`${language}: missing key ${key}`);
  }
}

for (const namespace of requiredStatusNamespaces) {
  assertNamespace(namespace);
}

for (const language of languages) {
  const map = localeMaps.get(language) ?? {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string') continue;
    if (rawEnumLabels.includes(value.trim())) {
      failures.push(`${language}: raw enum label "${value}" rendered by ${key}`);
    }
  }
}

if (!skipIndexCheck) validateIndexHtml();
validateTelegramModuleEncoding();

if (failures.length) {
  console.error(`i18n audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('i18n audit passed');

function readUtf8File(filePath, label) {
  try {
    const buffer = fs.readFileSync(filePath);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (source.includes('\uFFFD')) failures.push(`${label}: replacement character found`);
    return source;
  } catch (error) {
    failures.push(`${label}: invalid UTF-8 or unreadable file (${error.message})`);
    return null;
  }
}

function validateIndexHtml() {
  const source = readUtf8File(path.resolve(rootDir, 'index.html'), 'index.html');
  if (!source) return;
  if (!/<meta\s+charset=["']?UTF-8["']?\s*\/?>/i.test(source)) {
    failures.push('index.html: missing UTF-8 charset meta tag');
  }
}

function validateTelegramModuleEncoding() {
  if (!fs.existsSync(telegramFilePath)) return;
  const label = path.relative(rootDir, telegramFilePath).replace(/\\/g, '/');
  const source = readUtf8File(telegramFilePath, label);
  if (!source) return;

  const mojibakePattern = /(Ã|Â|â€™|â€œ|â€|ðŸ|ï¸|�|\?{4,})/g;
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const matches = line.match(mojibakePattern);
    if (!matches) return;
    const uniqueMatches = [...new Set(matches)];
    failures.push(`${label}:${index + 1}: suspicious mojibake token(s) ${uniqueMatches.join(', ')}`);
  });
}

function validateKey(language, key) {
  if (!/^[a-zA-Z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9][a-zA-Z0-9_-]*)*$/.test(key)) {
    failures.push(`${language}: malformed key ${key}`);
  }
}

function validateValue(language, key, value) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) failures.push(`${language}: empty value for ${key}`);
  if (trimmed === key) failures.push(`${language}: value unexpectedly equals key ${key}`);
  if (/\?{2,}/.test(value)) failures.push(`${language}: corrupted question marks in ${key}`);
  if ((language === 'fr' || language === 'ar') && /(?:[A-Za-zÀ-ÿ\u0600-\u06FF]\?[A-Za-zÀ-ÿ\u0600-\u06FF]?|\?[A-Za-zÀ-ÿ\u0600-\u06FF])/.test(value)) {
    failures.push(`${language}: suspicious replacement question mark in ${key}`);
  }
  if (/[\uFFFD]/.test(value)) failures.push(`${language}: replacement character in ${key}`);
  if (language === 'ar' && /[A-Za-z]{4,}/.test(value) && /[\u0600-\u06FF]/.test(key)) {
    failures.push(`${language}: suspicious Latin text in Arabic value for ${key}`);
  }
}

function flatten(value, prefix = '', output = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }

  output[prefix] = value;
  return output;
}

function assertNamespace(namespace) {
  for (const language of languages) {
    const map = localeMaps.get(language) ?? {};
    if (!Object.keys(map).some((key) => key.startsWith(`${namespace}.`))) {
      failures.push(`${language}: missing required namespace ${namespace}`);
    }
  }
}

function findDuplicateKeys(source) {
  const duplicates = [];
  const stack = [];
  const seen = new Set();
  const keyLinePattern = /^(\s*)"((?:[^"\\]|\\.)+)"\s*:/;

  for (const line of source.split(/\r?\n/)) {
    const match = keyLinePattern.exec(line);
    if (!match) continue;

    const indent = match[1].length;
    const level = Math.floor(indent / 2);
    const key = JSON.parse(`"${match[2]}"`);
    stack[level] = key;
    stack.length = level + 1;

    const fullPath = stack.join('.');
    if (seen.has(fullPath)) duplicates.push(fullPath);
    seen.add(fullPath);
  }

  return duplicates;
}
