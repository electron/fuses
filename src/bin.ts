#!/usr/bin/env node

import path from 'node:path';
import { parseArgs, styleText } from 'node:util';

import { flipFuses, getCurrentFuseWire } from './index.js';
import { FuseConfig, FuseV1Options, FuseVersion } from './config.js';
import { FuseState } from './constants.js';

const mode = process.argv[2];

const readHelpText = `electron-fuses read --app [path-to-app]`;
const writeHelpText = `electron-fuses write --app [path-to-app] <...key=on/off>`;

if (mode !== 'read' && mode !== 'write') {
  console.error('Invalid mode, check the usage below:');
  console.info(readHelpText);
  console.info(writeHelpText);
  process.exit(0);
}

function stringForState(state: FuseState) {
  switch (state) {
    case FuseState.ENABLE:
      return styleText(['green'], 'Enabled');
    case FuseState.DISABLE:
      return styleText(['red'], 'Disabled');
    case FuseState.INHERIT:
      return styleText(['yellow'], 'Inherited');
    case FuseState.REMOVED:
      return styleText(['red', 'strikethrough'], 'Removed');
  }
}

if (mode === 'read') {
  const { values: argv } = parseArgs({
    args: process.argv.slice(3),
    options: {
      app: {
        type: 'string',
      },
      help: {
        type: 'boolean',
        default: false,
      },
    },
  });

  if (argv.help) {
    console.log(readHelpText);
    process.exit(0);
  }

  if (!argv.app) {
    console.error('--app argument is required');
    process.exit(1);
  }

  console.log('Analyzing app:', styleText(['cyan'], path.basename(argv.app)));

  getCurrentFuseWire(argv.app)
    .then((config) => {
      const { version, resetAdHocDarwinSignature, strictlyRequireAllFuses, ...rest } = config;
      console.log(`Fuse Version: ${styleText(['cyan'], `v${version}`)}`);

      switch (config.version) {
        case FuseVersion.V1:
          for (const key of Object.keys(rest)) {
            console.log(
              `  ${styleText(['yellow'], FuseV1Options[key as any])} is ${stringForState(
                rest[key as any as keyof typeof rest]!,
              )}`,
            );
          }
          break;
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  const { values: argv, positionals } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: {
      app: {
        type: 'string',
      },
      help: {
        type: 'boolean',
        default: false,
      },
    },
  });

  if (argv.help) {
    console.log(writeHelpText);
    process.exit(0);
  }

  if (!argv.app) {
    console.error('--app argument is required');
    process.exit(1);
  }

  console.log('Analyzing app:', styleText(['cyan'], path.basename(argv.app)));

  getCurrentFuseWire(argv.app)
    .then((config) => {
      const { version, resetAdHocDarwinSignature, ...rest } = config;
      console.log(`Fuse Version: ${styleText(['cyan'], `v${version}`)}`);

      const keyPairs = positionals || [];
      for (const keyPair of keyPairs) {
        const [key, state] = keyPair.split('=');
        if (!key || !state) {
          console.error('Invalid fuse:', keyPair);
          console.error('Must be in the format FuseName=on/off');
          process.exit(1);
        }

        if (state !== 'on' && state !== 'off') {
          console.error('Invalid fuse state:', styleText(['yellow'], keyPair));
          console.error(
            `Fuses can only be set to the "${styleText(['green'], 'on')}" or "${styleText(['red'], 'off')}" state`,
          );
          process.exit(1);
        }

        switch (config.version) {
          case FuseVersion.V1:
            const validFuseNames = Object.keys(FuseV1Options).filter((k) => !/^[0-9]+$/.test(k));
            if (!validFuseNames.includes(key)) {
              console.error('Invalid fuse name', styleText(['yellow'], key));
              console.error(
                'Expected name to be one of',
                styleText(['yellow'], JSON.stringify(validFuseNames)),
              );
              process.exit(1);
            }
            const currentState = (config as any)[FuseV1Options[key as any]]!;
            const newState = state === 'on' ? FuseState.ENABLE : FuseState.DISABLE;
            if (currentState === newState) {
              console.log(
                `  ${styleText(['yellow'], key)} is already ${stringForState(
                  currentState,
                )} and will not be changed`,
              );
            } else {
              console.log(
                `  ${styleText(['yellow'], key)} is ${stringForState(
                  currentState,
                )} and will become ${stringForState(newState)}`,
              );
            }
            (config as any)[FuseV1Options[key as any]] = newState;
            break;
        }
      }

      console.log('Writing to app:', styleText(['cyan'], path.basename(argv.app!)));

      function adaptConfig(config: FuseConfig<FuseState>): FuseConfig<boolean> {
        const { version, resetAdHocDarwinSignature, ...rest } = config;
        const fuseConfig: FuseConfig<boolean> = {
          version,
          resetAdHocDarwinSignature,
        };

        for (const key of Object.keys(rest)) {
          (fuseConfig as any)[key] = (rest as any)[key] === FuseState.ENABLE;
        }

        return fuseConfig;
      }

      return flipFuses(argv.app!, adaptConfig(config));
    })
    .then(() => {
      console.log(styleText(['green'], 'Fuses written to disk'));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
