import { MetaWorker } from '@metaio/worker-model';

export type RemoveIndex<Q> = {
  [key in keyof Q as string extends key
    ? never
    : key extends string
    ? key
    : never]: Q[key];
};

export type MixedTaskConfig =
  | MetaWorker.Configs.DeployTaskConfig
  | MetaWorker.Configs.PostTaskConfig
  | MetaWorker.Configs.PublishTaskConfig;
