import { downloadArtifact } from '@electron/get';

import { supportedPlatforms } from './helpers.js';

export default async function setup() {
  console.log('\nDownloading all Electron binaries required for testing...');

  for (const [platform, arch] of supportedPlatforms) {
    await downloadArtifact({
      version: '20.0.0',
      platform,
      arch,
      artifactName: 'electron',
    });
  }

  console.log('Done...');
}
