import { MetaWorker } from '@metaio/worker-model';
import Hexo from 'hexo';
import process from 'process';
import resolve from 'resolve';

import { logger } from '../logger';

export class HexoService {
  constructor(
    private readonly taskConfig: MetaWorker.Configs.GitWorkerTaskConfig, // TOOD: HexoWorkerTaskConfig
  ) {
    const baseDir = `${taskConfig.taskWorkspace}/${taskConfig.gitReponame}`;
    logger.verbose(`Hexo work dir is: ${baseDir}`);
    // TODO: Check baseDir exist
    this.baseDir = baseDir;
  }

  private readonly baseDir: string;
  private inst: Hexo;

  private hexoGenerateCallback(err: Error, val: unknown): void {
    if (process.env.DEBUG)
      console.log('\x1B[35mhexoGenerateCallback:\x1B[39m', err, val);
    if (err) {
      logger.error(`Hexo generate callback error:`, err);
    } else {
      logger.verbose(`Hexo generate callback value: ${val}`);
    }
  }

  private async loadLocalHexoModule(
    path: string,
    args?: Hexo.InstanceOptions,
  ): Promise<Hexo> {
    const arg: Hexo.InstanceOptions = { ...args, debug: !!process.env.DEBUG };
    logger.verbose(
      `Try load Hexo module from: ${path}, args: ${JSON.stringify(arg)}`,
    );

    try {
      const modulePath = resolve.sync('hexo', { basedir: path });
      const localHexo = await require(modulePath);
      logger.info(`Use local Hexo module`);
      return new localHexo(path, arg) as Hexo;
    } catch (error) {
      logger.error(`Local hexo loading failed in ${path}`, error);
      logger.info(`Use worker Hexo module`);
      return new Hexo(path, arg);
    }
  }

  async init(args?: Hexo.InstanceOptions): Promise<void> {
    const _hexo = await this.loadLocalHexoModule(this.baseDir, args);

    await _hexo.init();
    logger.info(`Hexo version: ${_hexo.env.version}`);
    logger.info(`Hexo base directory: ${_hexo.base_dir}`);
    logger.info(`Hexo public directory: ${_hexo.public_dir}`);
    logger.info(`Hexo source directory: ${_hexo.source_dir}`);
    logger.info(`Hexo config file path: ${_hexo.config_path}`);
    logger.info(`Hexo has been initialized`);

    _hexo.on('generateBefore', () => {
      logger.verbose('Hexo event on generateBefore');
      const postCount = _hexo.locals.get('posts').count();
      logger.info(`Found ${postCount} Hexo posts`);
    });
    _hexo.on('generateAfter', () => {
      logger.verbose('Hexo event on generateAfter');
    });
    _hexo.on('exit', () => {
      logger.verbose('Hexo event on exit');
      logger.info(`Hexo exited`);
    });

    this.inst = _hexo;
  }

  async generateHexoStaticFiles() {
    logger.info(`Generating Hexo static files`);
    try {
      await this.inst.call('generate', this.hexoGenerateCallback);
      await this.inst.exit();
    } catch (error) {
      await this.inst.exit(error);
      throw error;
    }
  }
}
