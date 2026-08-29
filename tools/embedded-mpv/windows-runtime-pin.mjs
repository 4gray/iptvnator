#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(modulePath);

export const WINDOWS_RUNTIME_PIN_PATH = path.join(
    moduleDir,
    'windows-runtime-pin.json'
);
export const WINDOWS_RUNTIME_REPOSITORY = 'zhongfly/mpv-winbuild';
export const WINDOWS_RUNTIME_LICENSE_CLAIM =
    'Upstream labels this libmpv build LGPLv2.1+ with statically linked LGPLv3 FFmpeg; IPTVnator verifies the checksum and archive layout, not the complete transitive license closure.';

const RELEASE_TAG_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-([a-f0-9]{10})$/;
const ASSET_NAME_PATTERN =
    /^mpv-dev-lgpl-x86_64-(\d{8})-git-([a-f0-9]{10})\.7z$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const BUILD_RUN_PATTERN =
    /^https:\/\/github\.com\/zhongfly\/mpv-winbuild\/actions\/runs\/(\d+)$/;

function hasExactFields(value, fields) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).sort().join('\0') === [...fields].sort().join('\0')
    );
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Invalid Windows Embedded MPV runtime pin: ${message}`);
    }
}

function expectedAssetUrl(releaseTag, assetName) {
    return `https://github.com/${WINDOWS_RUNTIME_REPOSITORY}/releases/download/${releaseTag}/${assetName}`;
}

export function validateWindowsRuntimePin(pin) {
    assert(
        hasExactFields(pin, [
            'schemaVersion',
            'repository',
            'releaseTag',
            'publishedAt',
            'retentionDays',
            'asset',
            'upstream',
        ]),
        'root fields do not match schema version 1'
    );
    assert(pin.schemaVersion === 1, 'schemaVersion must be 1');
    assert(
        pin.repository === WINDOWS_RUNTIME_REPOSITORY,
        `repository must be ${WINDOWS_RUNTIME_REPOSITORY}`
    );
    assert(pin.retentionDays === 30, 'retentionDays must be 30');

    const releaseMatch = pin.releaseTag?.match(RELEASE_TAG_PATTERN);
    assert(releaseMatch, 'releaseTag has an unexpected format');
    const publishedAt = Date.parse(pin.publishedAt);
    assert(
        Number.isFinite(publishedAt),
        'publishedAt must be an ISO timestamp'
    );

    assert(
        hasExactFields(pin.asset, ['name', 'url', 'sha256']),
        'asset fields do not match schema version 1'
    );
    const assetMatch = pin.asset.name?.match(ASSET_NAME_PATTERN);
    assert(assetMatch, 'asset.name must be the non-v3 x86_64 LGPL dev archive');
    assert(
        assetMatch[1] === releaseMatch.slice(1, 4).join(''),
        'asset date must match the release tag date'
    );
    assert(
        assetMatch[2] === releaseMatch[4],
        'asset commit suffix must match the release tag'
    );
    assert(
        pin.asset.url === expectedAssetUrl(pin.releaseTag, pin.asset.name),
        'asset.url must be derived from the pinned release and asset name'
    );
    assert(
        SHA256_PATTERN.test(pin.asset.sha256),
        'asset.sha256 must be a lowercase SHA-256 digest'
    );

    assert(
        hasExactFields(pin.upstream, [
            'mpvCommit',
            'buildRunUrl',
            'licenseClaim',
        ]),
        'upstream fields do not match schema version 1'
    );
    assert(
        COMMIT_PATTERN.test(pin.upstream.mpvCommit),
        'upstream.mpvCommit must be a full commit hash'
    );
    assert(
        pin.upstream.mpvCommit.startsWith(releaseMatch[4]),
        'upstream.mpvCommit must match the release tag suffix'
    );
    assert(
        BUILD_RUN_PATTERN.test(pin.upstream.buildRunUrl),
        'upstream.buildRunUrl must identify the zhongfly build run'
    );
    assert(
        pin.upstream.licenseClaim === WINDOWS_RUNTIME_LICENSE_CLAIM,
        'upstream.licenseClaim must preserve the limited verification statement'
    );

    return pin;
}

export function readWindowsRuntimePin(pinPath = WINDOWS_RUNTIME_PIN_PATH) {
    return validateWindowsRuntimePin(
        JSON.parse(fs.readFileSync(pinPath, 'utf8'))
    );
}

export function serializeWindowsRuntimePin(pin) {
    validateWindowsRuntimePin(pin);
    return `${JSON.stringify(pin, null, 4)}\n`;
}

export function appendWindowsRuntimeGitHubOutputs(
    pin,
    outputPath = process.env.GITHUB_OUTPUT
) {
    validateWindowsRuntimePin(pin);
    assert(outputPath, 'GITHUB_OUTPUT is required for --github-output');
    fs.appendFileSync(
        outputPath,
        [
            `url=${pin.asset.url}`,
            `sha256=${pin.asset.sha256}`,
            `asset-name=${pin.asset.name}`,
            `release-tag=${pin.releaseTag}`,
            `published-at=${pin.publishedAt}`,
            '',
        ].join('\n')
    );
}

function main() {
    const pin = readWindowsRuntimePin();
    if (process.argv.includes('--github-output')) {
        appendWindowsRuntimeGitHubOutputs(pin);
    }
    console.log(
        `Windows Embedded MPV runtime pin: ${pin.releaseTag} (${pin.asset.sha256})`
    );
}

if (process.argv[1] === modulePath) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
