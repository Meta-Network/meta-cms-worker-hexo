import { MetaWorker } from '@metaio/worker-model';

import { HttpRequestService } from '../api';
import { HexoService } from '../hexo';
import { logger, loggerService } from '../logger';

export const startGitTask = async (): Promise<void> => {
  // const http = new HttpRequestService();
  // const taskConf = await http.getWorkerTaskFromBackend();
  // if (!taskConf) throw Error('Can not get task config from backend or gateway');

  const taskConf: MetaWorker.Configs.GitWorkerTaskConfig = {
    taskId: '123-ABC',
    taskMethod: MetaWorker.Enums.TaskMethod.GENERATE_HEXO_STATIC_FILES,
    taskWorkspace: '/tmp/123-ABC',
    username: 'Garfield550',
    title: 'Hexo starter',
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

  if (taskMethod === MetaWorker.Enums.TaskMethod.GENERATE_HEXO_STATIC_FILES) {
    logger.info(`Starting task generateHexoStaticFiles`);

    // TODO: Hexo service load config(Check it if not match task config, then create config)
    await hexoService.generateHexoStaticFiles();

    logger.info(`Task generateHexoStaticFiles finished`);
    // await http.reportWorkerTaskFinishedToBackend();
    loggerService.final('Task finished');
  }
};
