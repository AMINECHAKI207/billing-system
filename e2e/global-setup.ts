import { execSync } from 'child_process';
import path from 'path';

async function globalSetup() {
  const root = path.resolve(__dirname, '..');
  execSync('npm run e2e:db:prepare --workspace=server', {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      ENV_FILE: '.env.e2e',
      NODE_ENV: 'test',
    },
  });
}

export default globalSetup;
