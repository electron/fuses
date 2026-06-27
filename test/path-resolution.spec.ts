import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { pathToFuseFile } from '../src/index.js';

describe('pathToFuseFile()', () => {
  it('resolves the framework binary for a real macOS .app bundle path', () => {
    const bundle = path.join('/Applications', 'Electron.app');
    expect(pathToFuseFile(bundle)).toBe(
      path.resolve(
        bundle,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework',
      ),
    );
  });

  it('resolves the framework binary from the inner bundle binary path', () => {
    const innerBinary = path.join('/Applications', 'Electron.app', 'Contents', 'MacOS', 'Electron');
    expect(pathToFuseFile(innerBinary)).toBe(
      path.resolve(
        innerBinary,
        '..',
        '..',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework',
      ),
    );
  });

  it('does not treat an ancestor directory containing ".app" as a macOS bundle', () => {
    // Regression test for electron/fuses#118: a parent directory literally
    // named ".app" must not be mistaken for a macOS .app bundle.
    const linuxBinary = path.join('/home', 'user', '.app', 'electron-app', 'electron');
    expect(pathToFuseFile(linuxBinary)).toBe(linuxBinary);
  });

  it('does not treat a directory name merely containing ".app" as a macOS bundle', () => {
    // Regression test for electron/fuses#95: "my.app.win" is not a bundle.
    const winBinary = path.join('C:\\', 'projects', 'my.app.win', 'electron.exe');
    expect(pathToFuseFile(winBinary)).toBe(winBinary);
  });
});
