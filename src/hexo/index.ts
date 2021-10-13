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
import { LogContext, MixedTaskConfig } from '../types';
import { HexoConfig, HexoFrontMatter, HexoPostCreate } from '../types/hexo';
import { formatUrl, isEmptyObj } from '../utils';

export class HexoService {
  constructor(private readonly taskConfig: MixedTaskConfig) {
    this.context = { context: HexoService.name };
    const { task, git } = taskConfig;
    const dirPath = `${task.taskWorkspace}/${git.gitReponame}`;
    const baseDir = `${path.join(os.tmpdir(), dirPath)}`;
    logger.verbose(`Hexo work dir is: ${baseDir}`, this.context);
    const isExists = existsSync(baseDir);
    if (!isExists) throw Error(`Hexo work dir does not exists`);
    this.baseDir = baseDir;
  }

  private readonly context: LogContext;
  private readonly baseDir: string;
  private inst: Hexo;

  private async execChildProcess(cmd: string): Promise<boolean> {
    const promise = new Promise<boolean>((res, rej) => {
      const process = childProcess.exec(cmd, { cwd: this.baseDir });
      process.stdout.setEncoding('utf-8');
      process.stderr.setEncoding('utf-8');
      process.stdout.on('data', (data) => {
        logger.verbose(data, this.context);
      });
      process.stderr.on('data', (data) => {
        logger.error(data, this.context);
      });
      process.on('exit', (code, sig) => {
        if (code === 0) {
          logger.info(
            `Child process exec '${cmd}' with exit code ${code} and signal ${sig}`,
            this.context,
          );
          res(true);
        }
        rej(`Child process exec '${cmd}' failed with exit code ${code}`);
      });
      process.on('error', (err) => rej(err));
    });
    return await promise;
  }

  private guessPackageManager(findPath: string): 'npm' | 'yarn' {
    const yarnLock = path.join(findPath, 'yarn.lock');
    const isYarn = existsSync(yarnLock);
    if (isYarn) {
      logger.info(`Find yarn lockfile, use Yarn package manager`, this.context);
      return 'yarn';
    }
    logger.info(`Use NPM package manager`, this.context);
    return 'npm';
  }

  private async installNodeModules(): Promise<void> {
    logger.info(`Installing node modules for ${this.baseDir}`, this.context);
    const _pm = this.guessPackageManager(this.baseDir);
    if (_pm === 'yarn') {
      const process = await this.execChildProcess(
        'yarn install --production=false --frozen-lockfile',
      );
      if (process)
        logger.info(`Successfully install node modules`, this.context);
    }
    if (_pm === 'npm') {
      const process = await this.execChildProcess('npm ci');
      if (process)
        logger.info(`Successfully install node modules`, this.context);
    }
  }

  private async loadLocalHexoModule(
    path: string,
    args?: Hexo.InstanceOptions,
  ): Promise<Hexo> {
    const arg: Hexo.InstanceOptions = { ...args, debug: !!process.env.DEBUG };
    logger.verbose(
      `Try load Hexo module from: ${path}, args: ${JSON.stringify(arg)}`,
      this.context,
    );

    try {
      const modulePath = resolve.sync('hexo', { basedir: path });
      const localHexo = await require(modulePath);
      logger.info(`Use local Hexo module`, this.context);
      return new localHexo(path, arg) as Hexo;
    } catch (error) {
      logger.error(`Local hexo loading failed in ${path}`, error, this.context);
      logger.info(`Use worker Hexo module`, this.context);
      return new Hexo(path, arg);
    }
  }

  private async updateHexoConfigFile(
    taskConfig: MetaWorker.Configs.DeployTaskConfig,
  ): Promise<void> {
    // Get worker Hexo config
    const defConf = config.get<HexoConfig>('hexo', {} as HexoConfig);
    if (isEmptyObj(defConf))
      logger.warn(
        `Can not find the default Hexo config, will ignore it`,
        this.context,
      );

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
        this.context,
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
        logger.info(`Write ${confPath} successfully`, this.context);
        return;
      } catch (error) {
        logger.error(
          `Can not write Hexo config file, path: ${confPath}`,
          error,
          this.context,
        );
        throw error;
      }
    }
    // If has _config.yml, merge it
    if (isExists) {
      logger.verbose(
        `Found the Hexo config in ${this.baseDir}, will update it`,
        this.context,
      );
      try {
        const confRawData = await fs.readFile(confPath, 'utf8');
        const confRaw: HexoConfig = yaml.parse(confRawData);
        const confNew = { ...defConf, ...confRaw, ...userConf };
        const yamlStr = yaml.stringify(confNew);
        const data = new Uint8Array(Buffer.from(yamlStr));
        await fs.writeFile(confPath, data, { encoding: 'utf8' });
        logger.info(`Update ${confPath} successfully`, this.context);
        return;
      } catch (error) {
        logger.error(
          `Can not update Hexo config file, path: ${confPath}`,
          error,
          this.context,
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
    post: MetaWorker.Info.Post,
    replace: boolean,
  ): Promise<void> {
    try {
      if (replace) logger.info(`Hexo create replace mode on`, this.context);
      const postData: Hexo.Post.Data & HexoFrontMatter = {
        title: post.title,
        date: post.createdAt || post.updatedAt || Date.now(),
        updated: post.updatedAt || '',
        tags: post.tags || [],
        categories: post.categories || [],
        excerpt: post.summary || '',
      };
      logger.info(`Create post file, title: ${post.title}`, this.context);
      const _create = (await this.inst.post.create(
        postData,
        replace,
      )) as unknown;
      logger.info(
        `Successfully create post file: ${JSON.stringify(_create)}`,
        this.context,
      );
      await this.inst.exit();
      const { path } = _create as HexoPostCreate;
      await fs.appendFile(path, `\n${post.source}\n`);
      logger.info(`Successfully write source content to ${path}`, this.context);
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
    logger.info(`Hexo version: ${_hexo.env.version}`, this.context);
    logger.info(`Hexo base directory: ${_hexo.base_dir}`, this.context);
    logger.info(`Hexo public directory: ${_hexo.public_dir}`, this.context);
    logger.info(`Hexo source directory: ${_hexo.source_dir}`, this.context);
    logger.info(`Hexo config file path: ${_hexo.config_path}`, this.context);
    logger.info(`Hexo has been initialized`, this.context);

    _hexo.on('ready', () => {
      logger.verbose('Hexo initialization finished', this.context);
    });
    _hexo.on('new', (post) => {
      logger.verbose(`Create new post ${post.path}`, this.context);
    });
    _hexo.on('processBefore', () => {
      logger.verbose('Hexo process started', this.context);
    });
    _hexo.on('processAfter', () => {
      logger.verbose('Hexo process finished', this.context);
    });
    _hexo.on('generateBefore', () => {
      const postCount = _hexo.locals.get('posts').count();
      logger.verbose(`Found ${postCount} Hexo posts`, this.context);
    });
    _hexo.on('generateAfter', () => {
      logger.verbose('Hexo generate finished', this.context);
    });
    _hexo.on('exit', () => {
      logger.verbose(`Hexo exited`, this.context);
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
    logger.info(`Generating Hexo static files`, this.context);
    const _pm = this.guessPackageManager(this.baseDir);
    if (_pm === 'yarn') {
      await this.execChildProcess('yarn run hexo clean');
      await this.execChildProcess('yarn run hexo generate');
    }
    if (_pm === 'npm') {
      await this.execChildProcess('npm run hexo clean');
      await this.execChildProcess('npm run hexo generate');
    }
  }

  async createHexoPostFiles(update = false): Promise<void> {
    if (!isPostTask(this.taskConfig))
      throw new Error('Task config is not for create post');
    const { post } = this.taskConfig;
    await this.createHexoPostFile(post, update);
  }
}
