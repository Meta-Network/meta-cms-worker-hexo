import { checkAllowedTasks } from '@metaio/worker-common';
import { MetaWorker } from '@metaio/worker-model';

import { getBackendService } from '../api';
import { HexoService } from '../hexo';
import { logger, loggerService } from '../logger';
import { MixedTaskConfig } from '../types';

export const startTask = async (): Promise<void> => {
  const allowedTasks: MetaWorker.Enums.TaskMethod[] = [
    MetaWorker.Enums.TaskMethod.HEXO_UPDATE_CONFIG,
    MetaWorker.Enums.TaskMethod.HEXO_GENERATE_DEPLOY,
    MetaWorker.Enums.TaskMethod.HEXO_CREATE_POST,
    MetaWorker.Enums.TaskMethod.HEXO_UPDATE_POST,
    MetaWorker.Enums.TaskMethod.HEXO_CREATE_DRAFT,
    MetaWorker.Enums.TaskMethod.HEXO_UPDATE_DRAFT,
    MetaWorker.Enums.TaskMethod.HEXO_PUBLISH_DRAFT,
  ];

  const http = getBackendService();
  const taskConf = await http.getWorkerTaskFromBackend<MixedTaskConfig>();
  if (!taskConf) throw Error('Can not get task config from backend or gateway');

  const { taskId, taskMethod } = taskConf?.task;
  logger.info(`Task id ${taskId} start, method ${taskMethod}`);

  checkAllowedTasks(taskMethod, allowedTasks);

  const hexoService = new HexoService(taskConf);
  await hexoService.init();

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_UPDATE_CONFIG) {
    logger.info(`Starting task updateHexoConfigFiles`);
    await hexoService.updateHexoConfigFiles();
    logger.info(`Task updateHexoConfigFiles finished`);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_GENERATE_DEPLOY) {
    logger.info(`Starting task generateHexoStaticFiles`);
    await hexoService.generateHexoStaticFiles();
    logger.info(`Task generateHexoStaticFiles finished`);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_CREATE_POST) {
    logger.info(`Starting task createHexoPostFile`);
    await hexoService.createHexoPostFiles();
    logger.info(`Task createHexoPostFile finished`);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_UPDATE_POST) {
    logger.info(`Starting task createHexoPostFile, replase true`);
    await hexoService.createHexoPostFiles(true);
    logger.info(`Task createHexoPostFile finished`);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_CREATE_DRAFT) {
    logger.info(`Starting task createHexoDraftFile`);
    await hexoService.createHexoDraftFiles();
    logger.info(`Task createHexoDraftFile finished`);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_UPDATE_DRAFT) {
    logger.info(`Starting task createHexoDraftFile, replase true`);
    await hexoService.createHexoDraftFiles(true);
    logger.info(`Task createHexoDraftFile finished`);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.HEXO_PUBLISH_DRAFT) {
    logger.info(`Starting task publishHexoDraftFiles, replase true`);
    await hexoService.publishHexoDraftFiles(true);
    logger.info(`Task publishHexoDraftFiles finished`);
  }

  await http.reportWorkerTaskFinishedToBackend();
  loggerService.final('Task finished');
};
