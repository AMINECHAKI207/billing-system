import { logger } from '@config/logger';
import { recurringService } from '@modules/recurring/recurring.service';
let timer: NodeJS.Timeout | null = null;
export function startRecurringBillingJob() {
  const run = async () => { try { const results = await recurringService.executeDuePlans(); if (results.length) logger.info('Recurring billing job completed',{processed:results.length}); } catch(error){ logger.error('Recurring billing job failed',{error}); } };
  void run();
  timer=setInterval(()=>void run(),60*60*1000);
  timer.unref();
}
export function stopRecurringBillingJob(){ if(timer){clearInterval(timer);timer=null;} }
