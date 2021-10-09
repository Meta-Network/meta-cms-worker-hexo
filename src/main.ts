import cron from 'cron';
import timer from 'timers';

import { getBackendService } from './api';
import { logger } from './logger';
import { startTask } from './task';

async function bootstrap(): Promise<void> {
  const http = getBackendService();
  logger.info('App started');
  console.log(process.env);
  logger.info(JSON.stringify(process.env));
  await http.reportWorkerTaskStartedToBackend();

  timer
    .setTimeout(async () => {
      await startTask();
    }, 3000)
    .unref();

  const healthCheck = new cron.CronJob('*/10 * * * * *', async () => {
    logger.info('Health check');
    await http.reportWorkerTaskHealthStatusToBackend();
  });

  healthCheck.start();
}

bootstrap();
