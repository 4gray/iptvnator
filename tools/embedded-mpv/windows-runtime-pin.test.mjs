import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    appendWindowsRuntimeGitHubOutputs,
    readWindowsRuntimePin,
    serializeWindowsRuntimePin,
    validateWindowsRuntimePin,
    WINDOWS_RUNTIME_LICENSE_CLAIM,
    WINDOWS_RUNTIME_PIN_PATH,
} from './windows-runtime-pin.mjs';
import {
    pinFromUpstreamRelease,
    refreshWindowsRuntimePin,
    runtimePinAgeDays,
    selectNewestWindowsRuntimePin,
    WINDOWS_RUNTIME_REFRESH_AFTER_DAYS,
} from './update-windows-runtime-pin.mjs';

const CURRENT_PIN = readWindowsRuntimePin();

function releaseFixture({
    date = '2026-08-28',
    commit = 'e8673660ab123456789012345678901234567890',
    digest = '470437b5dc9f8c74092fdfab668e89bedf7b1a6385a53ffadf241a6a7a4c6ffb',
    runId = '33215046953',
    publishedAt = `${date}T22:32:29Z`,
} = {}) {
    const compactDate = date.replaceAll('-', '');
    const shortCommit = commit.slice(0, 10);
    const tag = `${date}-${shortCommit}`;
    const name = `mpv-dev-lgpl-x86_64-${compactDate}-git-${shortCommit}.7z`;
    return {
        draft: false,
        prerelease: false,
        tag_name: tag,
        published_at: publishedAt,
        body: [
            `MPV Git commit: https://github.com/mpv-player/mpv/commit/${commit}`,
            `Build Details: https://github.com/zhongfly/mpv-winbuild/actions/runs/${runId}`,
        ].join('\n'),
        assets: [
            {
                name,
                digest: `sha256:${digest}`,
                browser_download_url: `https://github.com/zhongfly/mpv-winbuild/releases/download/${tag}/${name}`,
            },
            {
                name: `mpv-dev-lgpl-x86_64-v3-${compactDate}-git-${shortCommit}.7z`,
                digest: `sha256:${'a'.repeat(64)}`,
                browser_download_url: 'https://example.invalid/v3.7z',
            },
        ],
    };
}

function response({ ok = true, status = 200, json } = {}) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Not Found',
        json: async () => json,
    };
}

function createPinFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impv-win-pin-'));
    const pinPath = path.join(root, 'windows-runtime-pin.json');
    fs.writeFileSync(pinPath, serializeWindowsRuntimePin(CURRENT_PIN));
    return { root, pinPath };
}

test('checked-in Windows runtime pin is internally consistent', () => {
    assert.equal(WINDOWS_RUNTIME_PIN_PATH.endsWith('.json'), true);
    assert.equal(
        CURRENT_PIN.asset.sha256,
        '317dfd9ee814be76e5f6e20b45efcc07440389a62b55dd85201829b4880510e0'
    );
    assert.equal(
        CURRENT_PIN.upstream.licenseClaim,
        WINDOWS_RUNTIME_LICENSE_CLAIM
    );
});

test('pin validation rejects a softened license-verification statement', () => {
    const invalid = structuredClone(CURRENT_PIN);
    invalid.upstream.licenseClaim = 'Verified LGPL runtime.';
    assert.throws(
        () => validateWindowsRuntimePin(invalid),
        /limited verification statement/
    );
});

test('upstream release selection excludes the v3 archive and keeps evidence', () => {
    const older = releaseFixture({
        date: '2026-08-27',
        commit: '182fa6ca49123456789012345678901234567890',
        publishedAt: '2026-08-27T12:41:23Z',
    });
    const latest = releaseFixture();
    const pin = selectNewestWindowsRuntimePin([older, latest]);

    assert.equal(pin.releaseTag, latest.tag_name);
    assert.equal(pin.asset.name, latest.assets[0].name);
    assert.equal(pin.asset.sha256, latest.assets[0].digest.slice(7));
    assert.equal(pin.upstream.mpvCommit, latest.body.match(/[a-f0-9]{40}/)[0]);
    assert.doesNotMatch(pin.asset.name, /-v3-/);
});

test('upstream release must provide GitHub digest and build evidence', () => {
    const missingDigest = releaseFixture();
    delete missingDigest.assets[0].digest;
    assert.throws(
        () => pinFromUpstreamRelease(missingDigest),
        /must expose a GitHub SHA-256 digest/
    );

    const missingEvidence = releaseFixture();
    missingEvidence.body = '';
    assert.throws(
        () => pinFromUpstreamRelease(missingEvidence),
        /lacks the expected mpv commit or build-run evidence/
    );
});

test('young available pin does not query releases or rewrite the file', async () => {
    const fixture = createPinFixture();
    let requestCount = 0;
    try {
        const result = await refreshWindowsRuntimePin({
            pinPath: fixture.pinPath,
            now: new Date('2026-08-29T00:00:00Z'),
            fetchImpl: async () => {
                requestCount += 1;
                return response();
            },
        });
        assert.equal(result.changed, false);
        assert.equal(result.reason, 'current');
        assert.equal(requestCount, 1);
        assert.equal(
            fs.readFileSync(fixture.pinPath, 'utf8'),
            serializeWindowsRuntimePin(CURRENT_PIN)
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('unavailable pin rotates to the newest downloadable release', async () => {
    const fixture = createPinFixture();
    const latest = releaseFixture();
    const requests = [];
    try {
        const result = await refreshWindowsRuntimePin({
            pinPath: fixture.pinPath,
            now: new Date('2026-08-29T00:00:00Z'),
            fetchImpl: async (url, options = {}) => {
                requests.push([url, options.method ?? 'GET']);
                if (url === CURRENT_PIN.asset.url) {
                    return response({ ok: false, status: 404 });
                }
                if (url.startsWith('https://api.github.com/')) {
                    return response({ json: [latest] });
                }
                return response();
            },
        });
        assert.equal(result.changed, true);
        assert.equal(result.reason, 'unavailable');
        assert.equal(
            readWindowsRuntimePin(fixture.pinPath).releaseTag,
            latest.tag_name
        );
        assert.deepEqual(
            requests.map((request) => request[1]),
            ['HEAD', 'GET', 'HEAD']
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('age threshold rotates an available pin before upstream retention', async () => {
    const fixture = createPinFixture();
    const latest = releaseFixture();
    try {
        const result = await refreshWindowsRuntimePin({
            pinPath: fixture.pinPath,
            now: new Date('2026-09-05T13:00:00Z'),
            fetchImpl: async (url) =>
                url.startsWith('https://api.github.com/')
                    ? response({ json: [latest] })
                    : response(),
        });
        assert.equal(
            runtimePinAgeDays(CURRENT_PIN, new Date('2026-09-05T13:00:00Z')) >=
                WINDOWS_RUNTIME_REFRESH_AFTER_DAYS,
            true
        );
        assert.equal(result.changed, true);
        assert.equal(result.reason, 'age-threshold');
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('GitHub output exposes only the validated checked-in pin', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impv-win-output-'));
    const outputPath = path.join(root, 'output');
    try {
        appendWindowsRuntimeGitHubOutputs(CURRENT_PIN, outputPath);
        const output = fs.readFileSync(outputPath, 'utf8');
        assert.match(output, new RegExp(`sha256=${CURRENT_PIN.asset.sha256}`));
        assert.match(
            output,
            new RegExp(`release-tag=${CURRENT_PIN.releaseTag}`)
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
