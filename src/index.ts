import * as cp from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FuseConfig, FuseV1Config, FuseV1Options, FuseVersion } from './config';
import { FuseState, SENTINEL } from './constants';

export * from './config';

const state = (b: boolean | undefined) =>
  b === undefined ? FuseState.INHERIT : b ? FuseState.ENABLE : FuseState.DISABLE;

const buildFuseV1Wire = (config: FuseV1Config, wireLength: number) => {
  const { version, ...nonVersionConfig } = config;
  const badFuseOption = Object.keys(nonVersionConfig).find(
    (fuseOption) => parseInt(fuseOption, 10) >= wireLength,
  );
  if (badFuseOption !== undefined) {
    throw new Error(
      `Trying to configure ${
        FuseV1Options[badFuseOption as any]
      } but the fuse wire in this version of Electron is not long enough`,
    );
  }

  return [
    state(config[FuseV1Options.RunAsNode]),
    state(config[FuseV1Options.EnableCookieEncryption]),
    state(config[FuseV1Options.EnableNodeOptionsEnvironmentVariable]),
    state(config[FuseV1Options.EnableNodeCliInspectArguments]),
    state(config[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]),
    state(config[FuseV1Options.OnlyLoadAppFromAsar]),
    state(config[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]),
    state(config[FuseV1Options.GrantFileProtocolExtraPrivileges]),
  ];
};

const pathToFuseFile = (pathToElectron: string) => {
  if (pathToElectron.endsWith('.app')) {
    return path.resolve(
      pathToElectron,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    );
  }
  if (pathToElectron.includes('.app')) {
    return path.resolve(
      pathToElectron,
      '..',
      '..',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    );
  }
  return pathToElectron;
};

const setFuseWire = async (
  pathToElectron: string,
  fuseVersion: FuseVersion,
  strictlyRequireAllFuses: boolean,
  fuseWireBuilder: (wireLength: number) => FuseState[],
  fuseNamer: (index: number) => string,
) => {
  const fuseFilePath = pathToFuseFile(pathToElectron);
  const electron = await fs.readFile(fuseFilePath);

  const firstSentinel = electron.indexOf(SENTINEL);
  const lastSentinel = electron.lastIndexOf(SENTINEL);
  // If the last sentinel is different to the first sentinel we are probably in a universal build
  // We should flip the fuses in both sentinels to affect both slices of the universal binary
  const sentinels =
    firstSentinel === lastSentinel ? [firstSentinel] : [firstSentinel, lastSentinel];

  for (const indexOfSentinel of sentinels) {
    if (indexOfSentinel === -1) {
      throw new Error(
        'Could not find sentinel in the provided Electron binary, fuses are only supported in Electron 12 and higher',
      );
    }

    const fuseWirePosition = indexOfSentinel + SENTINEL.length;

    const fuseWireVersion = electron[fuseWirePosition];
    if (parseInt(fuseVersion, 10) !== fuseWireVersion) {
      throw new Error(
        `Provided fuse wire version "${parseInt(
          fuseVersion,
          10,
        )}" does not match watch was found in the binary "${fuseWireVersion}".  You should update your usage of @electron/fuses.`,
      );
    }
    const fuseWireLength = electron[fuseWirePosition + 1];

    const wire = fuseWireBuilder(fuseWireLength).slice(0, fuseWireLength);
    if (wire.length < fuseWireLength && strictlyRequireAllFuses) {
      throw new Error(
        `strictlyRequireAllFuses: The fuse wire in the Electron binary has ${fuseWireLength} fuses but you only provided a config for ${wire.length} fuses, you may need to update @electron/fuses or provide additional fuse settings`,
      );
    }
    for (let i = 0; i < wire.length; i++) {
      const idx = fuseWirePosition + 2 + i;
      const currentState = electron[idx];
      const newState = wire[i];

      if (currentState === FuseState.REMOVED && newState !== FuseState.INHERIT) {
        console.warn(
          `Overriding fuse "${fuseNamer(
            i,
          )}" that has been marked as removed, setting this fuse is a noop`,
        );
      }
      if (newState === FuseState.INHERIT) {
        if (strictlyRequireAllFuses) {
          throw new Error(
            `strictlyRequireAllFuses: Missing explicit configuration for fuse ${fuseNamer(i)}`,
          );
        }
        continue;
      }
      electron[idx] = newState;
    }
  }

  await fs.writeFile(fuseFilePath, electron);

  return sentinels.length;
};

export const getCurrentFuseWire = async (
  pathToElectron: string,
): Promise<FuseConfig<FuseState>> => {
  const fuseFilePath = pathToFuseFile(pathToElectron);
  const electron = await fs.readFile(fuseFilePath);
  const fuseWirePosition = electron.indexOf(SENTINEL) + SENTINEL.length;

  if (fuseWirePosition - SENTINEL.length === -1) {
    throw new Error(
      'Could not find sentinel in the provided Electron binary, fuses are only supported in Electron 12 and higher',
    );
  }
  const fuseWireVersion = (electron[fuseWirePosition] as any) as FuseVersion;
  const fuseWireLength = electron[fuseWirePosition + 1];
  const fuseConfig: FuseConfig<FuseState> = {
    version: `${fuseWireVersion}` as FuseVersion,
  };

  for (let i = 0; i < fuseWireLength; i++) {
    const idx = fuseWirePosition + 2 + i;
    const currentState = electron[idx];
    switch (fuseConfig.version) {
      case FuseVersion.V1:
        fuseConfig[i as FuseV1Options] = currentState as FuseState;
        break;
    }
  }

  return fuseConfig;
};

export const flipFuses = async (
  pathToElectron: string,
  fuseConfig: FuseConfig,
): Promise<number> => {
  let numSentinels: number;

  switch (fuseConfig.version) {
    case FuseVersion.V1:
      numSentinels = await setFuseWire(
        pathToElectron,
        fuseConfig.version,
        fuseConfig.strictlyRequireAllFuses || false,
        buildFuseV1Wire.bind(null, fuseConfig),
        (i) => FuseV1Options[i],
      );
      break;
    default:
      throw new Error(`Unsupported fuse version number: ${fuseConfig.version}`);
  }

  // Reset the ad-hoc signature on macOS, should only be done for arm64 apps
  if (fuseConfig.resetAdHocDarwinSignature && pathToElectron.includes('.app')) {
    const pathToApp = `${pathToElectron.split('.app')[0]}.app`;
    const result = cp.spawnSync('codesign', [
      '--sign',
      '-',
      '--force',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      '--deep',
      pathToApp,
    ]);
    if (result.status !== 0) {
      console.error(result.stderr.toString());
      throw new Error(`Ad-hoc codesign failed with status: ${result.status}`);
    }
  }

  return numSentinels;
};
