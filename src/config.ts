export enum FuseVersion {
  V1 = '1',
}

/**
 * Maps config keys to their index in the fuse wire
 */
export enum FuseV1Options {
  RunAsNode = 0,
}

export type FuseV1Config = {
  version: FuseVersion.V1;
} & Partial<Record<FuseV1Options, boolean>>;

export type FuseConfig = FuseV1Config;
