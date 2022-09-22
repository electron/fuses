import { downloadArtifact } from '@electron/get';
import { supportedPlatforms } from './test/helpers';

module.exports = async () => {
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
};
