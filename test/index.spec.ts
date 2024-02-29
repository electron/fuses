import { makeUniversalApp } from '@electron/universal';
import * as fs from 'fs-extra';
import * as path from 'path';

import { FuseState } from '../src/constants';
import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } from '../src/index';
import {
  getElectronLocally,
  getTmpDir,
  readableFuseWire,
  supportedPlatforms,
  tmpPaths,
} from './helpers';

describe('getCurrentFuseWire()', () => {
  afterEach(async () => {
    while (tmpPaths.length) {
      await fs.remove(tmpPaths.pop()!);
    }
  });

  it('should return the expected defaults for Electron v20.0.0', async () => {
    const electronPath = await getElectronLocally('20.0.0', 'darwin', 'x64');
    expect(readableFuseWire(await getCurrentFuseWire(electronPath))).toMatchInlineSnapshot(`
      {
        "EnableCookieEncryption": "DISABLE",
        "EnableEmbeddedAsarIntegrityValidation": "DISABLE",
        "EnableNodeCliInspectArguments": "ENABLE",
        "EnableNodeOptionsEnvironmentVariable": "ENABLE",
        "OnlyLoadAppFromAsar": "DISABLE",
        "RunAsNode": "ENABLE",
        "version": "1",
      }
    `);
  });

  for (const [platform, arch] of supportedPlatforms) {
    it(`should work on ${platform}/${arch}`, async () => {
      const electronPath = await getElectronLocally('20.0.0', platform, arch);
      await expect(getCurrentFuseWire(electronPath)).resolves.toBeTruthy();
    });
  }
});

describe('flipFuses()', () => {
  it('should allow toggling a single fuse', async () => {
    const electronPath = await getElectronLocally('20.0.0', 'darwin', 'x64');
    expect((await getCurrentFuseWire(electronPath))[FuseV1Options.EnableCookieEncryption]).toEqual(
      FuseState.DISABLE,
    );
    const fuseWiresSeen = await flipFuses(electronPath, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableCookieEncryption]: true,
    });
    expect(fuseWiresSeen).toEqual(1);
    expect((await getCurrentFuseWire(electronPath))[FuseV1Options.EnableCookieEncryption]).toEqual(
      FuseState.ENABLE,
    );
  });

  it('should allow toggling multiple fuses', async () => {
    const electronPath = await getElectronLocally('20.0.0', 'darwin', 'x64');
    expect((await getCurrentFuseWire(electronPath))[FuseV1Options.EnableCookieEncryption]).toEqual(
      FuseState.DISABLE,
    );
    expect(
      (await getCurrentFuseWire(electronPath))[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
    ).toEqual(FuseState.DISABLE);
    await flipFuses(electronPath, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    });
    expect((await getCurrentFuseWire(electronPath))[FuseV1Options.EnableCookieEncryption]).toEqual(
      FuseState.ENABLE,
    );
    expect(
      (await getCurrentFuseWire(electronPath))[FuseV1Options.EnableEmbeddedAsarIntegrityValidation],
    ).toEqual(FuseState.ENABLE);
  });

  if (process.platform === 'darwin') {
    it('should work on universal macOS applications', async () => {
      const electronPathX64 = await getElectronLocally('20.0.0', 'darwin', 'x64');
      const electronPathArm64 = await getElectronLocally('20.0.0', 'darwin', 'arm64');
      for (const electronPath of [electronPathArm64, electronPathX64]) {
        await fs.move(
          path.resolve(electronPath, 'Contents', 'Resources', 'default_app.asar'),
          path.resolve(electronPath, 'Contents', 'Resources', 'app.asar'),
        );
      }
      const electronPathUniversal = path.resolve(await getTmpDir(), 'Electron.app');
      await makeUniversalApp({
        x64AppPath: electronPathX64,
        arm64AppPath: electronPathArm64,
        outAppPath: electronPathUniversal,
        force: false,
      });

      const fuseWiresSeen = await flipFuses(electronPathUniversal, {
        version: FuseVersion.V1,
        [FuseV1Options.EnableCookieEncryption]: true,
      });
      expect(fuseWiresSeen).toEqual(2);
    });
  }
});
