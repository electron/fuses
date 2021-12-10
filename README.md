# @electron/fuses

> Flip [Electron Fuses](https://github.com/electron/electron/blob/master/docs/tutorial/fuses.md) and customize your packaged build of Electron

<!-- [![CircleCI](https://circleci.com/gh/electron/fuses.svg?style=svg)](https://circleci.com/gh/electron/fuses) -->

## Usage

```typescript
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

await flipFuses(
  require('electron'), // Returns the path to the electron binary
  {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false, // Disables ELECTRON_RUN_AS_NODE
    [FuseV1Options.EnableCookieEncryption]: true, // Enables cookie encryption
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // Disables the NODE_OPTIONS environment variable
    [FuseV1Options.EnableNodeCliInspectArguments]: false, // Disables the --inspect and --inspect-brk family of CLI options
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, // Enables validation of the app.asar archive on macOS
    [FuseV1Options.OnlyLoadAppFromAsar]: true, // Enforces that Electron will only load your app from "app.asar" instead of its normal search paths
  },
);
```

### Apple Silicon

For `arm64` macOS builds of your app if you are not immediately codesigning your app after flipping
the fuses you will need to pass `resetAdHocDarwinSignature: true` to the `flipFuses` method.  Otherwise
the app will refuse to launch with code signature validation errors.  This is a new security measure on
Apple Silicon devices.

```typescript
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

await flipFuses(
  require('electron'),
  {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: targetPlatform === 'darwin' && targetArch === 'arm64',
    [FuseV1Options.RunAsNode]: false,
  },
);
```
