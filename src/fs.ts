import * as fs from 'fs-extra';
import { SENTINEL } from './constants';

export const getFuseHeaderPositions = async (fuseFilePath: string, firstOnly = false) => {
  let fileLength = 0;

  const firstAndLast = await new Promise<[number, number]>((resolve, reject) => {
    const firstAndLast: [number, number] = [-1, -1];

    // Keep a rolling list of chunks to not miss sentinels on chunk boundaries.
    let chunksPosition = 0;
    let chunksLength = 0;
    const chunks: Buffer[] = [];

    const readStream = fs.createReadStream(fuseFilePath);

    readStream.on('error', (error) => {
      reject(error);
    });

    readStream.on('data', (chunk) => {
      // Only process previous chunks if we can throw some away afterwards.
      if (chunks.length >= 2 && chunksLength >= 2 * SENTINEL.length) {
        const joined = Buffer.concat(chunks);

        if (firstAndLast[0] === -1) {
          const firstIndex = joined.indexOf(SENTINEL);
          if (firstIndex !== -1) {
            firstAndLast[0] = chunksPosition + firstIndex;
            if (firstOnly) {
              readStream.destroy();
              resolve(firstAndLast);
              return;
            }
          }
        }

        const lastIndex = joined.lastIndexOf(SENTINEL);
        if (lastIndex !== -1) {
          firstAndLast[1] = chunksPosition + lastIndex;
        }

        // Keep enough chunks to contain every possible starting position of a sentinel on a chunk boundary.
        // This is almost always just one, but a chunk isn't actually guaranteed to be longer than our sentinel.
        while (chunksLength - chunks[0].length >= SENTINEL.length - 1) {
          chunksPosition += chunks[0].length;
          chunksLength -= chunks[0].length;
          chunks.shift();
        }
      }

      // fs.createReadStream returns a Buffer if the encoding is not specified.
      chunk = chunk as Buffer;

      fileLength += chunk.length;
      chunksLength += chunk.length;
      chunks.push(chunk);
    });

    readStream.on('end', () => {
      const joined = Buffer.concat(chunks);

      if (firstAndLast[0] === -1) {
        const firstIndex = joined.indexOf(SENTINEL);
        if (firstIndex !== -1) {
          firstAndLast[0] = chunksPosition + firstIndex;
        }
      }

      const lastIndex = joined.lastIndexOf(SENTINEL);
      if (lastIndex !== -1) {
        firstAndLast[1] = chunksPosition + lastIndex;
      }

      resolve(firstAndLast);
    });
  });

  if (
    firstAndLast[0] === -1 ||
    firstAndLast[firstOnly ? 0 : 1] + SENTINEL.length + 2 > fileLength
  ) {
    throw new Error(
      'Could not find a fuse wire in the provided Electron binary. Fuses are only supported in Electron 12 and higher.',
    );
  }

  // If there's more than one fuse wire, we are probably in a universal build.
  // We should flip the fuses in both wires to affect both slices of the universal binary.
  if (!firstOnly && firstAndLast[0] !== firstAndLast[1]) {
    return firstAndLast.map((position) => position + SENTINEL.length);
  }

  return [firstAndLast[0] + SENTINEL.length];
};

export const readBytesOrClose = async (fileHandle: number, length: number, position: number) => {
  const buffer = Buffer.alloc(length);
  let bytesReadTotal = 0;

  while (bytesReadTotal < length) {
    const { bytesRead } = await fs
      .read(fileHandle, buffer, bytesReadTotal, length - bytesReadTotal, position + bytesReadTotal)
      .catch((error) => {
        return fs.close(fileHandle).then(
          () => {
            throw error;
          },
          () => {
            throw error;
          },
        );
      });

    if (bytesRead === 0) {
      throw new Error('Reached the end of the Electron binary while trying to read the fuses.');
    }

    bytesReadTotal += bytesRead;
  }

  return buffer;
};

export const writeBytesOrClose = async (fileHandle: number, buffer: Buffer, position: number) => {
  let bytesWrittenTotal = 0;

  while (bytesWrittenTotal < buffer.length) {
    const { bytesWritten } = await fs
      .write(
        fileHandle,
        buffer,
        bytesWrittenTotal,
        buffer.length - bytesWrittenTotal,
        position + bytesWrittenTotal,
      )
      .catch((error) => {
        console.error(
          `Failed to write the fuses to the Electron binary. The fuse wire may be corrupted. Tried to write 0x${buffer.toString(
            'hex',
          )} to position ${position}.`,
        );

        return fs.close(fileHandle).then(
          () => {
            throw error;
          },
          () => {
            throw error;
          },
        );
      });

    bytesWrittenTotal += bytesWritten;
  }
};
