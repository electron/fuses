import cp from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { FuseConfig, FuseV1Config, FuseV1Options, FuseVersion } from './config.js';
import { FuseState, SENTINEL } from './constants.js';

export * from './config.js';
export { FuseState } from './constants.js';

const SENTINEL_BYTES = Buffer.from(SENTINEL);
const SCAN_CHUNK_SIZE = 4 * 1024 * 1024;
const SCAN_CONCURRENCY = 2;

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
    state(config[FuseV1Options.WasmTrapHandlers]),
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

/**
 * Streams through the file in fixed-size chunks looking for the fuse sentinel,
 * so we never have to hold the entire (often 100+ MB) binary in memory.
 * Chunks are processed by a small pool of concurrent workers so that
 * Buffer.indexOf (CPU) on one chunk overlaps with the disk read (I/O) of the
 * next. Each chunk overreads a few bytes into its neighbour so a sentinel
 * straddling a boundary is still detected.
 */
const findSentinels = async (handle: fs.FileHandle, firstOnly: boolean): Promise<number[]> => {
  const { size } = await handle.stat();
  const overlap = SENTINEL_BYTES.length - 1;
  const numChunks = Math.ceil(size / SCAN_CHUNK_SIZE);
  const positions: number[] = [];

  let next = 0;
  let done = false;

  const worker = async () => {
    const buf = Buffer.allocUnsafe(SCAN_CHUNK_SIZE + overlap);
    while (!done) {
      const chunk = next++;
      if (chunk >= numChunks) return;
      const start = chunk * SCAN_CHUNK_SIZE;
      const len = Math.min(SCAN_CHUNK_SIZE + overlap, size - start);
      const { bytesRead } = await handle.read(buf, 0, len, start);
      const haystack = buf.subarray(0, bytesRead);

      let idx = haystack.indexOf(SENTINEL_BYTES);
      while (idx !== -1) {
        positions.push(start + idx);
        if (firstOnly) {
          done = true;
          return;
        }
        idx = haystack.indexOf(SENTINEL_BYTES, idx + 1);
      }
    }
  };

  const workers = Math.min(SCAN_CONCURRENCY, numChunks);
  await Promise.all(Array.from({ length: workers }, worker));

  return positions.sort((a, b) => a - b);
};

const HEADER_LEN = 2;
// Wire length is encoded in a single byte so it can never exceed 255.
const MAX_WIRE_LEN = 255;

const readFuseWire = async (handle: fs.FileHandle, sentinelPos: number) => {
  const wirePos = sentinelPos + SENTINEL_BYTES.length;
  const buf = Buffer.allocUnsafe(HEADER_LEN + MAX_WIRE_LEN);
  const { bytesRead } = await handle.read(buf, 0, buf.length, wirePos);
  const version = buf[0];
  const length = buf[1];
  return {
    version,
    length,
    wireBytes: buf.subarray(HEADER_LEN, Math.min(HEADER_LEN + length, bytesRead)),
    wireBytesPos: wirePos + HEADER_LEN,
  };
};

const setFuseWire = async (
  pathToElectron: string,
  fuseVersion: FuseVersion,
  strictlyRequireAllFuses: boolean,
  fuseWireBuilder: (wireLength: number) => FuseState[],
  fuseNamer: (index: number) => string,
) => {
  const fuseFilePath = pathToFuseFile(pathToElectron);
  const handle = await fs.open(fuseFilePath, 'r+');

  try {
    const sentinels = await findSentinels(handle, false);

    if (sentinels.length === 0) {
      throw new Error(
        'Could not find sentinel in the provided Electron binary, fuses are only supported in Electron 12 and higher',
      );
    }
    if (sentinels.length > 2) {
      throw new Error(
        `Found ${sentinels.length} copies of the fuse sentinel in the provided Electron binary. ` +
          'At most 2 are expected (one per slice of a universal macOS binary). ' +
          'This may indicate a corrupted binary or an unsupported build configuration.',
      );
    }

    // Two sentinels indicate a universal macOS build; flip fuses in each
    // slice so both architectures are covered.
    for (const indexOfSentinel of sentinels) {
      const {
        version: fuseWireVersion,
        length: fuseWireLength,
        wireBytes,
        wireBytesPos,
      } = await readFuseWire(handle, indexOfSentinel);

      if (parseInt(fuseVersion, 10) !== fuseWireVersion) {
        throw new Error(
          `Provided fuse wire version "${parseInt(
            fuseVersion,
            10,
          )}" does not match watch was found in the binary "${fuseWireVersion}".  You should update your usage of @electron/fuses.`,
        );
      }

      const wire = fuseWireBuilder(fuseWireLength).slice(0, fuseWireLength);
      if (wire.length < fuseWireLength && strictlyRequireAllFuses) {
        throw new Error(
          `strictlyRequireAllFuses: The fuse wire in the Electron binary has ${fuseWireLength} fuses but you only provided a config for ${wire.length} fuses, you may need to update @electron/fuses or provide additional fuse settings`,
        );
      }
      for (let i = 0; i < wire.length; i++) {
        const currentState = wireBytes[i];
        const newState = wire[i];

        if (currentState === FuseState.REMOVED && newState !== FuseState.INHERIT) {
          console.warn(
            `Overriding fuse "${fuseNamer(
              i,
            )}" that has been marked as removed, setting this fuse is a noop`,
          );
        }
        if (newState === FuseState.INHERIT) {
          if (strictlyRequireAllFuses) {
            throw new Error(
              `strictlyRequireAllFuses: Missing explicit configuration for fuse ${fuseNamer(i)}`,
            );
          }
          continue;
        }
        wireBytes[i] = newState;
      }

      await handle.write(wireBytes, 0, wireBytes.length, wireBytesPos);
    }

    return sentinels.length;
  } finally {
    await handle.close();
  }
};

export const getCurrentFuseWire = async (
  pathToElectron: string,
): Promise<FuseConfig<FuseState>> => {
  const fuseFilePath = pathToFuseFile(pathToElectron);
  const handle = await fs.open(fuseFilePath, 'r');

  try {
    const [sentinel] = await findSentinels(handle, true);

    if (sentinel === undefined) {
      throw new Error(
        'Could not find sentinel in the provided Electron binary, fuses are only supported in Electron 12 and higher',
      );
    }

    const {
      version: fuseWireVersion,
      length: fuseWireLength,
      wireBytes,
    } = await readFuseWire(handle, sentinel);

    const fuseConfig: FuseConfig<FuseState> = {
      version: `${fuseWireVersion}` as FuseVersion,
    };

    for (let i = 0; i < fuseWireLength; i++) {
      switch (fuseConfig.version) {
        case FuseVersion.V1:
          fuseConfig[i as FuseV1Options] = wireBytes[i] as FuseState;
          break;
      }
    }

    return fuseConfig;
  } finally {
    await handle.close();
  }
};

export const flipFuses = async (
  pathToElectron: string,
  fuseConfig: FuseConfig,
): Promise<number> => {
  let numSentinels: number;

  switch (fuseConfig.version) {
    case FuseVersion.V1:
      numSentinels = await setFuseWire(
        pathToElectron,
        fuseConfig.version,
        fuseConfig.strictlyRequireAllFuses || false,
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

  return numSentinels;
};
