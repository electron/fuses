import { downloadArtifact } from '@electron/get';
import { extract } from '@electron-internal/extract-zip';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type FuseConfig, FuseV1Options } from '../src/index.js';
import { FuseState, SENTINEL } from '../src/constants.js';

export const supportedPlatforms = [
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['win32', 'ia32'],
  ['win32', 'x64'],
  ['win32', 'arm64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
];

export const tmpPaths: string[] = [];

export async function getTmpDir() {
  const tmpDir = await fs.mkdtemp(path.resolve(os.tmpdir(), 'electron-fuses-'));
  tmpPaths.push(tmpDir);
  return tmpDir;
}

export async function getElectronLocally(version: string, platform: string, arch: string) {
  const electronZip = await downloadArtifact({
    version,
    platform,
    arch,
    artifactName: 'electron',
  });
  const tmpDir = await getTmpDir();
  await extract(electronZip, {
    dir: tmpDir,
  });

  if (platform === 'darwin' || platform === 'mas') {
    return path.resolve(tmpDir, 'Electron.app');
  } else if (platform === 'win32') {
    return path.resolve(tmpDir, 'electron.exe');
  } else {
    return path.resolve(tmpDir, 'electron');
  }
}

/**
 * Writes a stand-in for an Electron binary with a fuse wire of the given length, every fuse disabled. This makes it
 * possible to test fuses that no released version of Electron has yet.
 */
export async function getFakeElectronWithFuseWire(wireLength: number) {
  const tmpDir = await getTmpDir();
  const electronPath = path.resolve(tmpDir, 'electron');
  await fs.writeFile(
    electronPath,
    Buffer.concat([
      Buffer.from('not really electron'),
      Buffer.from(SENTINEL),
      Buffer.from([1, wireLength]),
      Buffer.alloc(wireLength, FuseState.DISABLE),
    ]),
  );
  return electronPath;
}

export function readableFuseWire(config: FuseConfig<FuseState>) {
  const cloned: any = { ...config };
  for (const key of Object.keys(cloned).filter((k) => k !== 'version')) {
    cloned[(FuseV1Options as any)[key]] = (FuseState as any)[cloned[key]];
    delete cloned[key];
  }

  return cloned;
}
