#!/usr/bin/env node
/**
 * Regenerates the offline DASH ClearKey fixtures used by the DASH e2e suites.
 *
 * Produces, next to this script:
 *   - clearkey-video.mp4 / clearkey-audio.mp4 / clearkey.mpd —
 *     CENC (`cenc` AES-CTR) encrypted VP9 video + Opus audio. Encryption is
 *     done by Shaka Packager because ffmpeg's mp4 muxer only writes `senc`
 *     sample-encryption metadata (Chromium requires `saiz`/`saio`) and cannot
 *     produce the subsample encryption that the VP9 CENC binding mandates.
 *   - clear-video.mp4 / clear-audio.mp4 / clear.mpd — same content, clear.
 *
 * VP9+Opus is deliberate: Playwright's bundled Chromium ships no proprietary
 * codecs (H.264/AAC), while royalty-free codecs work there and in Electron.
 *
 * Requirements:
 *   - ffmpeg (tested with 7.x) built with libvpx-vp9 and libopus
 *   - Shaka Packager: either set SHAKA_PACKAGER=/path/to/packager, install
 *     the `shaka-packager` npm package, or let this script fetch it once via
 *     `npm pack shaka-packager` into a temp directory (official Google
 *     package with prebuilt per-platform binaries).
 *
 * Byte-exact output across tool versions is not guaranteed — the committed
 * files are the source of truth for CI.
 *
 * Usage: node apps/web-e2e/src/fixtures/dash/generate-fixture.mjs
 */

import { execFileSync, execSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

/** Fixed, obviously synthetic 128-bit ClearKey test credentials. */
export const CLEARKEY_KID = '00112233445566778899aabbccddeeff';
export const CLEARKEY_KEY = 'ffeeddccbbaa99887766554433221100';

const DURATION_SECONDS = 4;
const FRAME_RATE = 24;

const masterPath = join(OUT_DIR, 'content-master.tmp.mp4');
const packager = resolvePackager();

try {
    // 1. Synthesize the clear master (muxed VP9+Opus).
    execFileSync(
        'ffmpeg',
        [
            '-y',
            '-f', 'lavfi', '-i',
            `testsrc2=duration=${DURATION_SECONDS}:size=320x180:rate=${FRAME_RATE}`,
            '-f', 'lavfi', '-i',
            `sine=frequency=440:duration=${DURATION_SECONDS}`,
            '-c:v', 'libvpx-vp9', '-b:v', '150k', '-g', String(FRAME_RATE),
            '-c:a', 'libopus', '-b:a', '48k',
            masterPath,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] }
    );

    // 2. Encrypted variant (subsample CENC for VP9, on-demand profile MPD).
    runPackager([
        `in=${masterPath},stream=video,output=${join(OUT_DIR, 'clearkey-video.mp4')},drm_label=CK`,
        `in=${masterPath},stream=audio,output=${join(OUT_DIR, 'clearkey-audio.mp4')},drm_label=CK`,
        '--enable_raw_key_encryption',
        '--keys', `label=CK:key_id=${CLEARKEY_KID}:key=${CLEARKEY_KEY}`,
        '--clear_lead', '0',
        '--protection_scheme', 'cenc',
        '--mpd_output', join(OUT_DIR, 'clearkey.mpd'),
    ]);
    console.log(`clearkey.mpd: CENC VP9+Opus (kid=${CLEARKEY_KID})`);

    // 3. Clear variant.
    runPackager([
        `in=${masterPath},stream=video,output=${join(OUT_DIR, 'clear-video.mp4')}`,
        `in=${masterPath},stream=audio,output=${join(OUT_DIR, 'clear-audio.mp4')}`,
        '--mpd_output', join(OUT_DIR, 'clear.mpd'),
    ]);
    console.log('clear.mpd: clear VP9+Opus');
} finally {
    rmSync(masterPath, { force: true });
}

function runPackager(args) {
    execFileSync(packager.command, [...packager.prefixArgs, ...args], {
        stdio: ['ignore', 'ignore', 'inherit'],
    });
}

function resolvePackager() {
    if (process.env.SHAKA_PACKAGER) {
        return { command: process.env.SHAKA_PACKAGER, prefixArgs: [] };
    }

    try {
        const launcher = createRequire(import.meta.url).resolve(
            'shaka-packager'
        );
        return { command: process.execPath, prefixArgs: [launcher] };
    } catch {
        return fetchPackagerViaNpmPack();
    }
}

/** One-off fetch of the official npm package with prebuilt binaries. */
function fetchPackagerViaNpmPack() {
    const workDir = mkdtempSync(join(tmpdir(), 'shaka-packager-'));
    console.log(`Fetching shaka-packager via npm pack into ${workDir} ...`);
    execSync('npm pack shaka-packager --silent', {
        cwd: workDir,
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    const tarball = readdirSync(workDir).find((name) =>
        name.endsWith('.tgz')
    );
    execSync(`tar -xzf ${JSON.stringify(tarball)}`, { cwd: workDir });

    const binaryName = {
        darwin: { arm64: 'packager-osx-arm64', x64: 'packager-osx-x64' },
        linux: { arm64: 'packager-linux-arm64', x64: 'packager-linux-x64' },
        win32: { x64: 'packager-win-x64.exe' },
    }[process.platform]?.[process.arch];
    if (!binaryName) {
        throw new Error(
            `No shaka-packager binary for ${process.platform}/${process.arch}; set SHAKA_PACKAGER manually.`
        );
    }

    const binaryPath = join(workDir, 'package', 'bin', binaryName);
    chmodSync(binaryPath, 0o755);
    return { command: binaryPath, prefixArgs: [] };
}
