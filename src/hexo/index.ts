import { MetaWorker } from '@metaio/worker-model';
import fs from 'fs/promises';
import Hexo from 'hexo';
import HexoInternalConfig from 'hexo/lib/hexo/default_config';
import { exists, existsSync } from 'hexo-fs';
import path from 'path';
import process from 'process';
import resolve from 'resolve';
import yaml from 'yaml';

import { config } from '../configs';
import { logger } from '../logger';
import { HexoConfig } from '../types/hexo';
import { isEmptyObj } from '../utils';

export class HexoService {
  constructor(
    private readonly taskConfig: MetaWorker.Configs.DeployTaskConfig,
  ) {
    const baseDir = `${taskConfig.taskWorkspace}/${taskConfig.gitReponame}`;
    logger.verbose(`Hexo work dir is: ${baseDir}`, {
      context: HexoService.name,
    });
    const isExists = existsSync(baseDir);
    if (!isExists) throw Error(`Hexo work dir does not exists`);
    this.baseDir = baseDir;
  }

  private readonly baseDir: string;
  private inst: Hexo;

  private hexoGenerateCallback(err: Error, val: unknown): void {
    if (process.env.DEBUG)
      console.log('\x1B[35mhexoGenerateCallback:\x1B[39m', err, val);
    if (err) {
      logger.error(`Hexo generate callback error:`, err, {
        context: HexoService.name,
      });
    } else {
      logger.verbose(`Hexo generate callback value: ${val}`, {
        context: HexoService.name,
      });
    }
  }

  private async loadLocalHexoModule(
    path: string,
    args?: Hexo.InstanceOptions,
  ): Promise<Hexo> {
    const arg: Hexo.InstanceOptions = { ...args, debug: !!process.env.DEBUG };
    logger.verbose(
      `Try load Hexo module from: ${path}, args: ${JSON.stringify(arg)}`,
      { context: HexoService.name },
    );

    try {
      const modulePath = resolve.sync('hexo', { basedir: path });
      const localHexo = await require(modulePath);
      logger.info(`Use local Hexo module`, { context: HexoService.name });
      return new localHexo(path, arg) as Hexo;
    } catch (error) {
      logger.error(`Local hexo loading failed in ${path}`, error, {
        context: HexoService.name,
      });
      logger.info(`Use worker Hexo module`, { context: HexoService.name });
      return new Hexo(path, arg);
    }
  }

  private async updateHexoConfigFile(
    taskConfig: MetaWorker.Configs.DeployTaskConfig,
  ): Promise<void> {
    // Get worker Hexo config
    const defConf = config.get<HexoConfig>('hexo', {} as HexoConfig);
    if (isEmptyObj(defConf))
      logger.warn(`Can not find the default Hexo config, will ignore it`, {
        context: HexoService.name,
      });

    // Create user Hexo config from taskConfig
    const userConf: Partial<HexoConfig> = {
      title: taskConfig.title,
      subtitle: taskConfig.subtitle || '',
      description: taskConfig.description || '',
      author:
        taskConfig.author || taskConfig.username || taskConfig.nickname || '',
      keywords: taskConfig.keywords || [],
      // No favicon on _config.yml(taskConfig.favicon)
      language: taskConfig.language || 'en',
      timezone: taskConfig.timezone || 'Asia/Shanghai', // If support UTC + or - will change it
      /**
       * On our platform, it always has a domain,
       * but Hexo not allow empty url,
       * if someting happen, use default
       */
      url: taskConfig.domain || 'https://example.com',
      theme: taskConfig.themeName,
    };

    const confName = '_config.yml';
    const confPath = path.join(this.baseDir, confName); // Current not support Hexo multi config path
    const isExists = await exists(confPath);
    // If no _config.yml, create it
    if (!isExists) {
      logger.warn(
        `Can not find the Hexo config in ${this.baseDir}, will create it`,
        { context: HexoService.name },
      );
      try {
        const conf: HexoConfig = {
          ...HexoInternalConfig,
          ...defConf,
          ...userConf,
        };
        const yamlStr = yaml.stringify(conf);
        const data = new Uint8Array(Buffer.from(yamlStr));
        await fs.writeFile(confPath, data, { encoding: 'utf8' });
        logger.info(`Write ${confPath} successfully`, {
          context: HexoService.name,
        });
        return;
      } catch (error) {
        logger.error(
          `Can not write Hexo config file, path: ${confPath}`,
          error,
          { context: HexoService.name },
        );
        throw error;
      }
    }
    // If has _config.yml, merge it
    if (isExists) {
      logger.verbose(
        `Found the Hexo config in ${this.baseDir}, will update it`,
        {
          context: HexoService.name,
        },
      );
      try {
        const confRawData = await fs.readFile(confPath, 'utf8');
        const confRaw: HexoConfig = yaml.parse(confRawData);
        const confNew = { ...defConf, ...confRaw, ...userConf };
        const yamlStr = yaml.stringify(confNew);
        const data = new Uint8Array(Buffer.from(yamlStr));
        await fs.writeFile(confPath, data, { encoding: 'utf8' });
        logger.info(`Update ${confPath} successfully`, {
          context: HexoService.name,
        });
        return;
      } catch (error) {
        logger.error(
          `Can not update Hexo config file, path: ${confPath}`,
          error,
          { context: HexoService.name },
        );
        return;
      }
    }
  }

  async init(args?: Hexo.InstanceOptions): Promise<void> {
    // Update _config.yml before Hexo init
    await this.updateHexoConfigFile(this.taskConfig);

    const _hexo = await this.loadLocalHexoModule(this.baseDir, args);

    await _hexo.init();
    logger.info(`Hexo version: ${_hexo.env.version}`, {
      context: HexoService.name,
    });
    logger.info(`Hexo base directory: ${_hexo.base_dir}`, {
      context: HexoService.name,
    });
    logger.info(`Hexo public directory: ${_hexo.public_dir}`, {
      context: HexoService.name,
    });
    logger.info(`Hexo source directory: ${_hexo.source_dir}`, {
      context: HexoService.name,
    });
    logger.info(`Hexo config file path: ${_hexo.config_path}`, {
      context: HexoService.name,
    });
    logger.info(`Hexo has been initialized`, { context: HexoService.name });

    _hexo.on('generateBefore', () => {
      logger.verbose('Hexo event on generateBefore', {
        context: HexoService.name,
      });
      const postCount = _hexo.locals.get('posts').count();
      logger.info(`Found ${postCount} Hexo posts`, {
        context: HexoService.name,
      });
    });
    _hexo.on('generateAfter', () => {
      logger.verbose('Hexo event on generateAfter', {
        context: HexoService.name,
      });
    });
    _hexo.on('exit', () => {
      logger.verbose('Hexo event on exit', { context: HexoService.name });
      logger.info(`Hexo exited`, { context: HexoService.name });
    });

    this.inst = _hexo;
  }

  async updateHexoConfigFiles(): Promise<void> {
    await this.updateHexoConfigFile(this.taskConfig);
    // TODO: update Hexo theme config file
  }

  async generateHexoStaticFiles(): Promise<void> {
    logger.info(`Generating Hexo static files`, { context: HexoService.name });
    try {
      await this.inst.call('generate', this.hexoGenerateCallback);
      await this.inst.exit();
    } catch (error) {
      await this.inst.exit(error);
      throw error;
    }
  }
}
