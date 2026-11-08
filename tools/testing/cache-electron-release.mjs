import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { version } = require('electron/package.json');
const checksums = require('electron/checksums.json');
const requireFromElectron = createRequire(
    require.resolve('electron/package.json')
);
const { downloadArtifact } = requireFromElectron('@electron/get');

export async function cacheElectronRelease(platform, arch) {
    return downloadArtifact({
        version,
        artifactName: 'electron',
        platform,
        arch,
        cacheRoot: process.env.electron_config_cache,
        checksums,
        downloader: {
            async download(_url, destination) {
                execFileSync(
                    'gh',
                    [
                        'release',
                        'download',
                        `v${version}`,
                        '--repo',
                        'electron/electron',
                        '--pattern',
                        basename(destination),
                        '--output',
                        destination,
                    ],
                    { stdio: 'inherit', timeout: 180_000 }
                );
            },
        },
    });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    const [platform, ...architectures] = process.argv.slice(2);
    for (const arch of architectures) {
        console.log(await cacheElectronRelease(platform, arch));
    }
}
