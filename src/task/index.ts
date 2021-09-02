import { MetaWorker } from '@metaio/worker-model';

import { HttpRequestService } from '../api';
import { HexoService } from '../hexo';
import { logger, loggerService } from '../logger';

export const startTask = async (): Promise<void> => {
  // const http = new HttpRequestService();
  // const taskConf = await http.getWorkerTaskFromBackend();
  // if (!taskConf) throw Error('Can not get task config from backend or gateway');

  const commonDoing = async (http: HttpRequestService): Promise<void> => {
    // await http.reportWorkerTaskFinishedToBackend();
    loggerService.final('Task finished');
  };

  const taskConf: MetaWorker.Configs.GitWorkerTaskConfig = {
    taskId: '123-ABC',
    taskMethod: MetaWorker.Enums.TaskMethod.GENERATE_HEXO_STATIC_FILES,
    taskWorkspace: '/tmp/123-ABC',
    username: 'Garfield550',
    title: 'My awesome site',
    description: 'WOW. Such Doge!',
    keywords: ['Test'],
    language: 'en',
    timezone: 'UTC+8',
    configId: 15,
    templateName: 'hexo-starter',
    templateRepoUrl: 'https://github.com/hexojs/hexo-starter.git',
    templateBranchName: 'master',
    gitToken: '',
    gitUsername: 'Garfield550',
    gitReponame: 'hexo-starter',
    gitBranchName: 'master',
    gitType: MetaWorker.Enums.GitServiceType.GITHUB,
  };

  const { taskId, taskMethod } = taskConf;
  logger.info(`Task id ${taskId} start, method ${taskMethod}`);

  const hexoService = new HexoService(taskConf);
  await hexoService.init();

  if (taskMethod === MetaWorker.Enums.TaskMethod.UPDATE_HEXO_CONFIG_FILES) {
    logger.info(`Starting task updateHexoConfigFiles`);

    await hexoService.updateHexoConfigFiles();

    logger.info(`Task updateHexoConfigFiles finished`);

    // await commonDoing(http);
  }

  if (taskMethod === MetaWorker.Enums.TaskMethod.GENERATE_HEXO_STATIC_FILES) {
    logger.info(`Starting task generateHexoStaticFiles`);

    await hexoService.generateHexoStaticFiles();

    logger.info(`Task generateHexoStaticFiles finished`);

    // await commonDoing(http);
  }
};
