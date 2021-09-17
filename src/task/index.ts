import { BackendTaskService } from '@metaio/worker-common';
import { MetaWorker } from '@metaio/worker-model';

import { getBackendService } from '../api';
import { HexoService } from '../hexo';
import { logger, loggerService } from '../logger';
import { MixedTaskConfig } from '../types';

export const startTask = async (): Promise<void> => {
  const http = getBackendService();
  const taskConf = await http.getWorkerTaskFromBackend<MixedTaskConfig>();
  if (!taskConf) throw Error('Can not get task config from backend or gateway');

  const commonDoing = async (http: BackendTaskService): Promise<void> => {
    await http.reportWorkerTaskFinishedToBackend();
    loggerService.final('Task finished');
  };

  const { taskId, taskMethod } = taskConf?.task;
  logger.info(`Task id ${taskId} start, method ${taskMethod}`);

  const hexoService = new HexoService(taskConf);
  await hexoService.init();

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_UPDATE_CONFIG) {
    logger.info(`Starting task updateHexoConfigFiles`);

    await hexoService.updateHexoConfigFiles();

    logger.info(`Task updateHexoConfigFiles finished`);

    await commonDoing(http);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_GENERATE_DEPLOY) {
    logger.info(`Starting task generateHexoStaticFiles`);

    await hexoService.generateHexoStaticFiles();

    logger.info(`Task generateHexoStaticFiles finished`);

    // TODO: Deploy

    await commonDoing(http);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_CREATE_POST) {
    logger.info(`Starting task createHexoPostFile`);

    await hexoService.createHexoPostFiles();

    logger.info(`Task createHexoPostFile finished`);
  }
};
