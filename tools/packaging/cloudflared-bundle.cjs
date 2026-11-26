const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const version = '2026.10.7';
const sourceCommit = '872b241f94871665c1c157adefcf90c11f0ead96';
const releaseUrl = `https://github.com/cloudflare/cloudflared/releases/download/${version}/`;
const licenseUrl = `https://raw.githubusercontent.com/cloudflare/cloudflared/${sourceCommit}/LICENSE`;
const licenseHash =
    '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd';

// Pin the GitHub release asset digests. The downloadable macOS archives
// differ from the checksums in the release description.
const assets = new Map([
    [
        'win32-x64',
        [
            'windows-amd64.exe',
            '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
        ],
    ],
    [
        'win32-ia32',
        [
            'windows-386.exe',
            '88c6b972b410db0e26745f593510d772c825a13c5a2374819e3f13a05b333082',
        ],
    ],
    [
        'darwin-x64',
        [
            'darwin-amd64.tgz',
            '02f3edfd87684dd5b705607688e4eb4b323f6e777b81e7b3a85af556aa356848',
        ],
    ],
    [
        'darwin-arm64',
        [
            'darwin-arm64.tgz',
            '3586ccf397e98e5f437e60e7c307ca6ac463e110580503af8bb8e6f9ebf831bd',
        ],
    ],
    [
        'linux-x64',
        [
            'linux-amd64',
            '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',
        ],
    ],
    [
        'linux-arm64',
        [
            'linux-arm64',
            '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775',
        ],
    ],
    [
        'linux-armv7l',
        [
            'linux-armhf',
            '04548d1d5e6a45eaec43916078538192e447256bcc3551bc8265c4ece06a655b',
        ],
    ],
]);

async function downloadVerified(url, sha256) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok)
        throw new Error(`Download failed (${response.status}): ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
        throw new Error(`cloudflared SHA-256 mismatch: ${url}`);
    }
    return bytes;
}

function readMacExecutable(archive) {
    // Extract only the executable to stdout, never unpack paths to disk.
    return execFileSync('tar', ['-xOzf', '-', 'cloudflared'], {
        input: archive,
        maxBuffer: 80 * 1024 * 1024,
    });
}

async function bundleCloudflared(resourceDir, platform, arch) {
    const target = `${platform}-${arch}`;
    const asset = assets.get(target);
    if (!asset)
        throw new Error(`No pinned cloudflared release asset for ${target}`);
    const [suffix, sha256] = asset;
    const assetName = `cloudflared-${suffix}`;
    const [download, license] = await Promise.all([
        downloadVerified(releaseUrl + assetName, sha256),
        downloadVerified(licenseUrl, licenseHash),
    ]);
    const executable =
        platform === 'darwin' ? readMacExecutable(download) : download;
    const bundle = join(resourceDir, 'cloudflared');
    const filename = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, 'LICENSE'), license);
    await writeFile(
        join(bundle, 'UPSTREAM.txt'),
        `Cloudflare cloudflared ${version}\n${releaseUrl + assetName}\n` +
            `Source: https://github.com/cloudflare/cloudflared/tree/${sourceCommit}\n` +
            `SHA-256 of upstream release asset: ${sha256}\n`
    );
    await writeFile(join(bundle, filename), executable, { mode: 0o755 });
}

module.exports = { bundleCloudflared };
