import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-i18n-quality-'));

try {
  runExpectSuccess(['node', 'scripts/audit-i18n.mjs'], 'current locale audit');
  runExpectSuccess(['node', 'scripts/scan-hardcoded-i18n.mjs'], 'current hardcoded text scan');
  runExpectFailure(['node', 'scripts/scan-hardcoded-i18n.mjs', '--self-test'], 'hardcoded button label self-test');

  const fixtureLocaleDir = path.join(tempDir, 'locales');
  fs.mkdirSync(fixtureLocaleDir, { recursive: true });
  for (const language of ['en', 'fr', 'ar']) {
    fs.copyFileSync(path.join(rootDir, 'src', 'i18n', 'locales', `${language}.json`), path.join(fixtureLocaleDir, `${language}.json`));
  }

  const ar = JSON.parse(fs.readFileSync(path.join(fixtureLocaleDir, 'ar.json'), 'utf8'));
  delete ar.common.save;
  ar.common.error = '????';
  fs.writeFileSync(path.join(fixtureLocaleDir, 'ar.json'), `${JSON.stringify(ar, null, 2)}\n`, 'utf8');
  runExpectFailure(['node', 'scripts/audit-i18n.mjs', '--locale-dir', fixtureLocaleDir, '--skip-index'], 'missing Arabic key and corrupted Arabic self-test');

  const fr = JSON.parse(fs.readFileSync(path.join(fixtureLocaleDir, 'fr.json'), 'utf8'));
  fr.expenses.status.workflow.PAID = 'PAID';
  fs.writeFileSync(path.join(fixtureLocaleDir, 'fr.json'), `${JSON.stringify(fr, null, 2)}\n`, 'utf8');
  runExpectFailure(['node', 'scripts/audit-i18n.mjs', '--locale-dir', fixtureLocaleDir, '--skip-index'], 'raw PAID status self-test');

  console.log('i18n quality tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function runExpectSuccess(command, label) {
  const result = spawnSync(command[0], command.slice(1), { cwd: rootDir, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`${label} failed unexpectedly`);
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }
}

function runExpectFailure(command, label) {
  const result = spawnSync(command[0], command.slice(1), { cwd: rootDir, encoding: 'utf8' });
  if (result.status === 0) {
    console.error(`${label} passed unexpectedly`);
    console.error(result.stdout);
    process.exit(1);
  }
}
