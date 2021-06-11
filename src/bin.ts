#!/usr/bin/env node

import * as chalk from 'chalk';
import * as minimist from 'minimist';
import * as path from 'path';

import { getCurrentFuseWire } from '.';
import { FuseV1Options, FuseVersion } from './config';
import { FuseState } from './constants';

interface FuseCLIArgs {
  electron?: string;
  help?: boolean;
}

const mode = process.argv[2];

const helpText = `electron-fuses read --electron [path-to-electron]`;

if (mode !== 'read' && mode !== 'write') {
  console.error('Invalid mode, check the usage below:');
  console.info(helpText);
  process.exit(0);
}

if (mode === 'write') {
  console.error('Writing the fuse wire via the CLI is not currently supported');
  process.exit(1);
}

const argv = minimist<FuseCLIArgs>(process.argv.slice(3), {
  string: ['electron'],
  boolean: ['help'],
});

if (argv.help) {
  console.log(helpText);
  process.exit(0);
}

if (!argv.electron) {
  console.error('--electron argument is required');
  process.exit(1);
}

function stringForState(state: FuseState) {
  switch (state) {
    case FuseState.ENABLE:
      return chalk.green('Enabled');
    case FuseState.DISABLE:
      return chalk.red('Disabled');
    case FuseState.INHERIT:
      return chalk.yellow('Inherited');
    case FuseState.REMOVED:
      return chalk.strikethrough(chalk.red('Removed'));
  }
}

console.log('Analyzing app:', chalk.cyan(path.basename(argv.electron)));

getCurrentFuseWire(argv.electron)
  .then((config) => {
    const { version, resetAdHocDarwinSignature, ...rest } = config;
    console.log(`Fuse Version: ${chalk.cyan(`v${version}`)}`);

    switch (config.version) {
      case FuseVersion.V1:
        for (const key of Object.keys(rest)) {
          console.log(
            `  ${chalk.yellow(FuseV1Options[key as any])} is ${stringForState(
              rest[(key as any) as keyof typeof rest]!,
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
