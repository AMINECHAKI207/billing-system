import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const srcDir = path.resolve(rootDir, 'src');
const baselinePath = path.resolve(rootDir, 'scripts', 'i18n-hardcoded-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');
const selfTest = process.argv.includes('--self-test');

const visibleAttributes = new Set([
  'aria-label',
  'alt',
  'label',
  'placeholder',
  'title',
]);
const fileExtensions = new Set(['.tsx', '.jsx']);
const ignoredDirs = new Set(['locales', 'dist', 'node_modules']);
const ignoredFiles = new Set([
  path.normalize('src/vite-env.d.ts'),
]);
const allowedExact = new Set([
  '-',
  '/',
  ':',
  '...',
  'MAD',
  'Promise',
  'USD',
  'EUR',
  'index',
]);
const technicalPatterns = [
  /^https?:\/\//,
  /^\/api\//,
  /^[A-Z0-9_]+$/,
  /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+)+$/,
  /^[#.][a-zA-Z0-9_-]+$/,
  /^[\d\s.,:%/+()-]+$/,
  /^(GET|POST|PUT|PATCH|DELETE)$/,
];

const findings = selfTest ? runSelfTest() : scanProject();
const baseline = loadBaseline();
const baselineIds = new Set(baseline.map((entry) => entry.id));
const newFindings = findings.filter((finding) => !baselineIds.has(finding.id));

if (updateBaseline) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(findings.map(toBaselineEntry), null, 2)}\n`, 'utf8');
  console.log(`i18n scan baseline updated with ${findings.length} finding(s)`);
  process.exit(0);
}

if (newFindings.length) {
  console.error(`i18n hardcoded-text scan failed with ${newFindings.length} new issue(s):`);
  for (const finding of newFindings) {
    console.error(`- ${finding.file}:${finding.line} "${finding.text}"`);
    console.error(`  Suggested action: replace visible text with useTranslation() and a locale key.`);
  }
  process.exit(1);
}

console.log(`i18n hardcoded-text scan passed (${findings.length} baseline finding(s), 0 new)`);

function scanProject() {
  const files = listFiles(srcDir).filter((filePath) => fileExtensions.has(path.extname(filePath)));
  return files.flatMap(scanFile);
}

function scanFile(filePath) {
  const relative = normalize(path.relative(rootDir, filePath));
  if (ignoredFiles.has(relative)) return [];
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, index) => {
    if (line.includes('i18n-scan-ignore-line')) return;
    for (const match of line.matchAll(/>\s*([^<>{}`]+?)\s*</g)) {
      addFinding(findings, relative, index + 1, match[1], 'jsx-text');
    }
    for (const match of line.matchAll(/\b([a-zA-Z-]+)=["']([^"']*[A-Za-zÀ-ÿ\u0600-\u06FF][^"']*)["']/g)) {
      if (!visibleAttributes.has(match[1])) continue;
      addFinding(findings, relative, index + 1, match[2], `attribute:${match[1]}`);
    }
  });

  return findings;
}

function addFinding(findings, file, line, rawText, kind) {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!isUserFacingText(text)) return;
  findings.push({
    id: hash(`${file}:${line}:${kind}:${text}`),
    file,
    line,
    text,
    kind,
  });
}

function isUserFacingText(text) {
  if (!text || text.length < 2) return false;
  if (allowedExact.has(text)) return false;
  if (/[{}]|&&|\|\||=>|[=!<>]=| as | \? /.test(text)) return false;
  if (!/[A-Za-zÀ-ÿ\u0600-\u06FF]/.test(text)) return false;
  if (technicalPatterns.some((pattern) => pattern.test(text))) return false;
  if (/^\{.*\}$/.test(text)) return false;
  return true;
}

function listFiles(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(fullPath));
    else output.push(fullPath);
  }
  return output;
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return [];
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

function toBaselineEntry(finding) {
  return {
    id: finding.id,
    file: finding.file,
    line: finding.line,
    text: finding.text,
    kind: finding.kind,
  };
}

function normalize(value) {
  return value.replace(/\\/g, '/');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function runSelfTest() {
  const fixtures = [
    {
      file: 'src/__i18n_self_test__/HardcodedButton.tsx',
      line: 3,
      text: 'Submit',
      kind: 'jsx-text',
    },
    {
      file: 'src/__i18n_self_test__/HardcodedButton.tsx',
      line: 4,
      text: 'Download PDF',
      kind: 'attribute:title',
    },
  ];
  for (const fixture of fixtures) {
    fixture.id = hash(`${fixture.file}:${fixture.line}:${fixture.kind}:${fixture.text}`);
  }
  return fixtures;
}
