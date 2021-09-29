import { isDeployTask, isPostTask } from '@metaio/worker-common';
import { MetaWorker } from '@metaio/worker-model';
import childProcess from 'child_process';
import fs from 'fs/promises';
import Hexo from 'hexo';
import HexoInternalConfig from 'hexo/lib/hexo/default_config';
import { exists, existsSync } from 'hexo-fs';
import os from 'os';
import path from 'path';
import process from 'process';
import resolve from 'resolve';
import yaml from 'yaml';

import { config } from '../configs';
import { logger } from '../logger';
import { MixedTaskConfig } from '../types';
import { HexoConfig, HexoFrontMatter, HexoPostCreate } from '../types/hexo';
import { formatUrl, isEmptyObj } from '../utils';

export class HexoService {
  constructor(private readonly taskConfig: MixedTaskConfig) {
    const { task, git } = taskConfig;
    const dirPath = `${task.taskWorkspace}/${git.gitReponame}`;
    const baseDir = `${path.join(os.tmpdir(), dirPath)}`;
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

  private async execChildProcess(cmd: string): Promise<boolean> {
    const promise = new Promise<boolean>((res, rej) => {
      const process = childProcess.exec(cmd, { cwd: this.baseDir });
      process.on('exit', (code, sig) => {
        logger.info(
          `Child process exec ${cmd} return code ${code} and signal ${sig}`,
          {
            context: HexoService.name,
          },
        );
        res(true);
      });
      process.on('error', (err) => rej(err));
    });
    return await promise;
  }

  private async installNodeModules(): Promise<void> {
    logger.info(`Installing node modules for ${this.baseDir}`, {
      context: HexoService.name,
    });
    const yarnLock = path.join(this.baseDir, 'yarn.lock');
    const isYarn = existsSync(yarnLock);
    if (isYarn) {
      logger.info(`Find yarn lockfile, use Yarn to install modules`, {
        context: HexoService.name,
      });
      const process = await this.execChildProcess(
        'yarn install --production=false --frozen-lockfile',
      );
      if (process)
        logger.info(`Successfully install node modules`, {
          context: HexoService.name,
        });
    } else {
      logger.info(`Use NPM to install modules`, { context: HexoService.name });
      const process = await this.execChildProcess('npm ci');
      if (process)
        logger.info(`Successfully install node modules`, {
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
    const { site, user, theme } = taskConfig;
    const userConf: Partial<HexoConfig> = {
      title: site.title,
      subtitle: site.subtitle || '',
      description: site.description || '',
      author: site.author || user.username || user.nickname || '',
      keywords: site.keywords || [],
      // No favicon on _config.yml(taskConfig.favicon)
      language: site.language || 'en',
      timezone: site.timezone || 'Asia/Shanghai', // If support UTC + or - will change it
      /**
       * On our platform, it always has a domain,
       * but Hexo not allow empty url,
       * if someting happen, use default
       */
      url: formatUrl(site.domain) || 'https://example.com',
      theme: theme.themeName,
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

  private async updateHexoThemeConfigFile(
    taskConfig: MetaWorker.Configs.DeployTaskConfig,
  ): Promise<void> {
    // TODO: update Hexo theme config file
  }

  private async createHexoPostFile(
    taskConfig: MetaWorker.Configs.PostTaskConfig,
  ): Promise<void> {
    const { post } = taskConfig;
    try {
      const postData: Hexo.Post.Data & HexoFrontMatter = {
        title: post.title,
        date: post.createdAt || post.updatedAt || Date.now(),
        updated: post.updatedAt || '',
        tags: post.tags || [],
        categories: post.category || '',
        excerpt: post.summary || '',
      };
      logger.info(`Create post file, title: ${post.title}`, {
        context: HexoService.name,
      });
      const _create = (await this.inst.post.create(postData)) as unknown;
      logger.info(`Successfully create post file: ${JSON.stringify(_create)}`, {
        context: HexoService.name,
      });
      await this.inst.exit();
      const { path } = _create as HexoPostCreate;
      await fs.appendFile(path, `\n${post.source}\n`);
      logger.info(`Successfully write source content to ${path}`, {
        context: HexoService.name,
      });
    } catch (error) {
      await this.inst.exit(error);
      throw error;
    }
  }

  async init(args?: Hexo.InstanceOptions): Promise<void> {
    if (isDeployTask(this.taskConfig)) {
      // Update _config.yml before Hexo init
      await this.updateHexoConfigFile(this.taskConfig);
    }

    await this.installNodeModules();
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
    if (!isDeployTask(this.taskConfig))
      throw new Error(`Task config is not for deploy`);
    await this.updateHexoConfigFile(this.taskConfig);
    await this.updateHexoThemeConfigFile(this.taskConfig);
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

  async createHexoPostFiles(): Promise<void> {
    if (!isPostTask(this.taskConfig))
      throw new Error('Task config is not for create post');
    await this.createHexoPostFile(this.taskConfig);
  }
}
