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
  },
);
```
