import { downloadArtifact } from '@electron/get';
import * as extractZip from 'extract-zip';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FuseConfig, FuseV1Options } from '../src';
import { FuseState } from '../src/constants';

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
  await extractZip(electronZip, {
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

export function readableFuseWire(config: FuseConfig<FuseState>) {
  const cloned: any = { ...config };
  for (const key of Object.keys(cloned).filter((k) => k !== 'version')) {
    cloned[(FuseV1Options as any)[key]] = (FuseState as any)[cloned[key]];
    delete cloned[key];
  }

  return cloned;
}
