import { makeUniversalApp } from '@electron/universal';
import { describe, expect, it, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { FuseState } from '../src/constants.js';
import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } from '../src/index.js';
import {
  getElectronLocally,
  getTmpDir,
  readableFuseWire,
  supportedPlatforms,
  tmpPaths,
} from './helpers.js';

describe('getCurrentFuseWire()', () => {
  afterEach(async () => {
    while (tmpPaths.length) {
      await fs.rm(tmpPaths.pop()!, { recursive: true });
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
    const sentinels = await flipFuses(electronPath, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableCookieEncryption]: true,
    });
    expect(sentinels).toEqual(1);
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
        await fs.rename(
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

      const sentinels = await flipFuses(electronPathUniversal, {
        version: FuseVersion.V1,
        [FuseV1Options.EnableCookieEncryption]: true,
      });
      expect(sentinels).toEqual(2);
    });
  }

  describe('strictlyRequireAllFuses', () => {
    it('should fail when missing fuse configuration', async () => {
      const electronPath = await getElectronLocally('20.0.0', 'darwin', 'x64');
      await expect(
        // @ts-expect-error strictlyRequireAllFuses is actually type safe, so we have to _really_ try here
        flipFuses(electronPath, {
          version: FuseVersion.V1,
          strictlyRequireAllFuses: true,
          [FuseV1Options.EnableCookieEncryption]: true,
        }),
      ).rejects.toMatchInlineSnapshot(
        `[Error: strictlyRequireAllFuses: Missing explicit configuration for fuse RunAsNode]`,
      );
      // Doesn't actually flip any fuses
      expect(
        (await getCurrentFuseWire(electronPath))[FuseV1Options.EnableCookieEncryption],
      ).toEqual(FuseState.DISABLE);
    });
  });

  // This test may have to be updated as we add new fuses, update the Electron version and add a new config for the fuse wire
  it('should succeed when all fuse configurations are provided', async () => {
    const electronPath = await getElectronLocally('29.0.0', 'darwin', 'x64');
    await expect(
      flipFuses(electronPath, {
        version: FuseVersion.V1,
        strictlyRequireAllFuses: true,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.EnableNodeCliInspectArguments]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
        [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.RunAsNode]: true,
      }),
    ).resolves.toMatchInlineSnapshot(`1`);
    // Actually flips a fuse
    expect((await getCurrentFuseWire(electronPath))[FuseV1Options.EnableCookieEncryption]).toEqual(
      FuseState.ENABLE,
    );
  });
});
