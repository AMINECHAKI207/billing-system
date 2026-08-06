import { prisma } from '@config/database';
import { cleanDemoTimesheets, demoPrefix } from '../src/demo/timesheets-demo.shared';

async function main() {
  const includeUsers = process.argv.includes('--users');
  await cleanDemoTimesheets({ includeUsers });
  console.log(`${demoPrefix} cleanup completed.${includeUsers ? ' Demo users were removed.' : ' Demo users were kept.'}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
