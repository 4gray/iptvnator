#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
    readWindowsRuntimePin,
    serializeWindowsRuntimePin,
    validateWindowsRuntimePin,
    WINDOWS_RUNTIME_LICENSE_CLAIM,
    WINDOWS_RUNTIME_PIN_PATH,
    WINDOWS_RUNTIME_REPOSITORY,
} from './windows-runtime-pin.mjs';

const modulePath = fileURLToPath(import.meta.url);
const RELEASES_API = `https://api.github.com/repos/${WINDOWS_RUNTIME_REPOSITORY}/releases?per_page=50`;
const ASSET_NAME_PATTERN = /^mpv-dev-lgpl-x86_64-\d{8}-git-[a-f0-9]{10}\.7z$/;

export const WINDOWS_RUNTIME_REFRESH_AFTER_DAYS = 14;

function githubApiHeaders() {
    return {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'iptvnator-windows-runtime-pin-updater',
        ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
    };
}

async function fetchJson(url, fetchImpl) {
    const response = await fetchImpl(url, { headers: githubApiHeaders() });
    if (!response.ok) {
        throw new Error(
            `Unable to query Windows runtime releases: ${response.status} ${response.statusText}`
        );
    }
    return response.json();
}

function extractUpstreamEvidence(body) {
    const mpvCommit = body?.match(
        /github\.com\/mpv-player\/mpv\/commit\/([a-f0-9]{40})/i
    )?.[1];
    const buildRunId = body?.match(
        /github\.com\/zhongfly\/mpv-winbuild\/actions\/runs\/(\d+)/i
    )?.[1];
    if (!mpvCommit || !buildRunId) {
        throw new Error(
            'Latest Windows runtime release lacks the expected mpv commit or build-run evidence.'
        );
    }
    return {
        mpvCommit: mpvCommit.toLowerCase(),
        buildRunUrl: `https://github.com/zhongfly/mpv-winbuild/actions/runs/${buildRunId}`,
    };
}

export function pinFromUpstreamRelease(release) {
    if (release?.draft || release?.prerelease) {
        throw new Error(
            'Windows runtime pin cannot use a draft or prerelease.'
        );
    }
    const matchingAssets = (release?.assets ?? []).filter((asset) =>
        ASSET_NAME_PATTERN.test(asset?.name ?? '')
    );
    if (matchingAssets.length !== 1) {
        throw new Error(
            `Release ${release?.tag_name ?? '<unknown>'} must contain exactly one non-v3 x86_64 LGPL dev archive.`
        );
    }
    const asset = matchingAssets[0];
    const sha256 = asset.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
    if (!sha256) {
        throw new Error(
            `Release asset ${asset.name} must expose a GitHub SHA-256 digest.`
        );
    }
    const evidence = extractUpstreamEvidence(release.body);
    return validateWindowsRuntimePin({
        schemaVersion: 1,
        repository: WINDOWS_RUNTIME_REPOSITORY,
        releaseTag: release.tag_name,
        publishedAt: release.published_at,
        retentionDays: 30,
        asset: {
            name: asset.name,
            url: asset.browser_download_url,
            sha256,
        },
        upstream: {
            ...evidence,
            licenseClaim: WINDOWS_RUNTIME_LICENSE_CLAIM,
        },
    });
}

export function selectNewestWindowsRuntimePin(releases) {
    if (!Array.isArray(releases)) {
        throw new Error('Windows runtime releases response must be an array.');
    }
    const candidates = releases
        .filter((release) => !release?.draft && !release?.prerelease)
        .filter((release) =>
            (release?.assets ?? []).some((asset) =>
                ASSET_NAME_PATTERN.test(asset?.name ?? '')
            )
        )
        .sort(
            (left, right) =>
                Date.parse(right.published_at) - Date.parse(left.published_at)
        );
    if (candidates.length === 0) {
        throw new Error('No suitable Windows LGPL runtime release was found.');
    }
    return pinFromUpstreamRelease(candidates[0]);
}

export function runtimePinAgeDays(pin, now = new Date()) {
    return (now.getTime() - Date.parse(pin.publishedAt)) / 86_400_000;
}

export async function isRuntimeAssetAvailable(url, fetchImpl = fetch) {
    try {
        const response = await fetchImpl(url, {
            method: 'HEAD',
            redirect: 'follow',
            headers: {
                'User-Agent': 'iptvnator-windows-runtime-pin-updater',
            },
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function refreshWindowsRuntimePin({
    pinPath = WINDOWS_RUNTIME_PIN_PATH,
    now = new Date(),
    force = false,
    dryRun = false,
    fetchImpl = fetch,
} = {}) {
    const current = readWindowsRuntimePin(pinPath);
    const currentAvailable = await isRuntimeAssetAvailable(
        current.asset.url,
        fetchImpl
    );
    const ageDays = runtimePinAgeDays(current, now);
    const refreshReason = force
        ? 'forced'
        : !currentAvailable
          ? 'unavailable'
          : ageDays >= WINDOWS_RUNTIME_REFRESH_AFTER_DAYS
            ? 'age-threshold'
            : null;

    if (!refreshReason) {
        return {
            changed: false,
            reason: 'current',
            current,
            next: current,
            ageDays,
        };
    }

    const releases = await fetchJson(RELEASES_API, fetchImpl);
    const next = selectNewestWindowsRuntimePin(releases);
    if (!(await isRuntimeAssetAvailable(next.asset.url, fetchImpl))) {
        throw new Error(
            `Selected Windows runtime asset is not downloadable: ${next.asset.url}`
        );
    }
    const changed =
        serializeWindowsRuntimePin(next) !==
        serializeWindowsRuntimePin(current);
    if (changed && !dryRun) {
        fs.writeFileSync(pinPath, serializeWindowsRuntimePin(next));
    }
    return { changed, reason: refreshReason, current, next, ageDays };
}

function appendGitHubOutputs(result) {
    if (!process.env.GITHUB_OUTPUT) {
        return;
    }
    fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        [
            `changed=${result.changed}`,
            `reason=${result.reason}`,
            `release-tag=${result.next.releaseTag}`,
            '',
        ].join('\n')
    );
}

async function main() {
    const result = await refreshWindowsRuntimePin({
        force: process.argv.includes('--force'),
        dryRun: process.argv.includes('--dry-run'),
    });
    appendGitHubOutputs(result);
    const action = result.changed ? 'updated' : 'kept';
    console.log(
        `Windows Embedded MPV runtime pin ${action}: ${result.next.releaseTag} (${result.reason}).`
    );
}

if (process.argv[1] === modulePath) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
