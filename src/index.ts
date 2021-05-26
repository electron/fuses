import * as fs from 'fs-extra';
import * as path from 'path';
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
  ];
};

const pathToFuseFile = (pathToElectron: string) => {
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
  const electron = await fs.readFile(fuseFilePath);
  const fuseWirePosition = electron.indexOf(SENTINEL) + SENTINEL.length;

  if (fuseWirePosition - SENTINEL.length === -1) {
    throw new Error(
      'Could not find sentinel in the provided ELectron binary, fuses are only supported in Electron 12 and higher',
    );
  }
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
    if (newState === FuseState.INHERIT) continue;
    electron[idx] = newState;
  }

  await fs.writeFile(fuseFilePath, electron);
};

export const flipFuses = (pathToElectron: string, fuseConfig: FuseConfig) => {
  switch (fuseConfig.version) {
    case FuseVersion.V1:
      return setFuseWire(
        pathToElectron,
        fuseConfig.version,
        buildFuseV1Wire.bind(null, fuseConfig),
        (i) => FuseV1Options[i],
      );
    default:
      throw new Error(`Unsupported fuse version number: ${fuseConfig.version}`);
  }
};
