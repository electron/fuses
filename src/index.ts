import * as cp from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { FuseConfig, FuseV1Config, FuseV1Options, FuseVersion } from './config';
import { FuseState } from './constants';
import { getFuseHeaderPositions, readBytesOrClose, writeBytesOrClose } from './fs';

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
  fuseWireBuilder: (wireLength: number) => FuseState[],
  fuseNamer: (index: number) => string,
) => {
  const fuseFilePath = pathToFuseFile(pathToElectron);
  const headerPositions = await getFuseHeaderPositions(fuseFilePath);
  const fileHandle = await fs.open(fuseFilePath, 'r+');

  for (const headerPosition of headerPositions) {
    const header = await readBytesOrClose(fileHandle, 2, headerPosition);
    const [fuseWireVersion, fuseWireLength] = [header[0], header[1]];
    const fuseWireBuffer = await readBytesOrClose(fileHandle, fuseWireLength, headerPosition + 2);

    if (parseInt(fuseVersion, 10) !== fuseWireVersion) {
      throw new Error(
        `Provided fuse wire version "${parseInt(
          fuseVersion,
          10,
        )}" does not match watch was found in the binary "${fuseWireVersion}".  You should update your usage of @electron/fuses.`,
      );
    }

    const wire = fuseWireBuilder(fuseWireLength).slice(0, fuseWireLength);
    let changesMade = false;

    for (let i = 0; i < wire.length; i++) {
      const currentState = fuseWireBuffer[i];
      const newState = wire[i];

      if (currentState === FuseState.REMOVED && newState !== FuseState.INHERIT) {
        console.warn(
          `Overriding fuse "${fuseNamer(
            i,
          )}" that has been marked as removed, setting this fuse is a noop`,
        );
      }

      if (newState === FuseState.INHERIT) continue;

      fuseWireBuffer[i] = newState;
      changesMade = true;
    }

    if (changesMade) {
      await writeBytesOrClose(fileHandle, fuseWireBuffer, headerPosition + 2);
    }
  }

  await fs.close(fileHandle);

  return headerPositions.length;
};

export const getCurrentFuseWire = async (
  pathToElectron: string,
): Promise<FuseConfig<FuseState>> => {
  const fuseFilePath = pathToFuseFile(pathToElectron);

  const headerPosition = (await getFuseHeaderPositions(fuseFilePath, true))[0];

  const fileHandle = await fs.open(fuseFilePath, 'r');
  const header = await readBytesOrClose(fileHandle, 2, headerPosition);
  const [fuseWireVersion, fuseWireLength] = [(header[0] as any) as FuseVersion, header[1]];
  const fuseWireBuffer = await readBytesOrClose(fileHandle, fuseWireLength, headerPosition + 2);
  await fs.close(fileHandle);

  const fuseConfig: FuseConfig<FuseState> = {
    version: `${fuseWireVersion}` as FuseVersion,
  };

  for (let i = 0; i < fuseWireLength; i++) {
    const currentState = fuseWireBuffer[i];

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
  let fuseWiresSeen: number;

  switch (fuseConfig.version) {
    case FuseVersion.V1:
      fuseWiresSeen = await setFuseWire(
        pathToElectron,
        fuseConfig.version,
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

  return fuseWiresSeen;
};
