export enum FuseVersion {
  V1 = '1',
}

/**
 * Maps config keys to their index in the fuse wire
 */
export enum FuseV1Options {
  RunAsNode = 0,
  EnableCookieEncryption = 1,
  EnableNodeOptionsEnvironmentVariable = 2,
  EnableNodeCliInspectArguments = 3,
  EnableEmbeddedAsarIntegrityValidation = 4,
  OnlyLoadAppFromAsar = 5,
  LoadBrowserProcessSpecificV8Snapshot = 6,
}

export type FuseV1Config<T = boolean> = {
  version: FuseVersion.V1;
  resetAdHocDarwinSignature?: boolean;
} & Partial<Record<FuseV1Options, T>>;

export type FuseConfig<T = boolean> = FuseV1Config<T>;
