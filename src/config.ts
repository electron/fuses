export enum FuseVersion {
  V1 = '1',
}

/**
 * Maps config keys to their index in the fuse wire
 */
export enum FuseV1Options {
  RunAsNode = 0,
  EnableCookieEncryption = 1,
}

export type FuseV1Config<T = boolean> = {
  version: FuseVersion.V1;
  resetAdHocDarwinSignature?: boolean;
} & Partial<Record<FuseV1Options, T>>;

export type FuseConfig<T = boolean> = FuseV1Config<T>;
