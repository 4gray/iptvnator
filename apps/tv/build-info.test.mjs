import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tvBuildInfo, tvBuildIdentity } from './build-info.ts';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'tv-build-info-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'apps/tv/public'), { recursive: true });
    const app = {
        title: 'Synthetic TV',
        version: '0.9.7',
        id: 'com.synthetic.tv',
        vendor: 'Synthetic publisher',
    };
    writeFileSync(
        join(root, 'apps/tv/public/appinfo.json'),
        JSON.stringify(app)
    );
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
            version: '0.30.0',
            license: 'MIT',
            homepage: 'https://project.invalid',
        })
    );
    return { root, app };
}

test('TV build metadata follows the manifests and remains usable without Git', (t) => {
    const { root, app } = fixture(t);
    assert.deepEqual(tvBuildInfo(root, '2026-01-02T03:04:05.000Z'), {
        title: app.title,
        version: app.version,
        vendor: app.vendor,
        appId: app.id,
        releaseVersion: '0.30.0',
        license: 'MIT',
        projectUrl: 'https://project.invalid',
        revision: undefined,
        modified: false,
        builtAt: '2026-01-02T03:04:05.000Z',
    });
});

test('a new revision and local changes invalidate the build identity cache key', (t) => {
    const { root } = fixture(t);
    const git = (...args) =>
        execFileSync(
            'git',
            [
                '-c',
                'core.hooksPath=/dev/null',
                '-c',
                'commit.gpgsign=false',
                ...args,
            ],
            { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
    git('init', '--quiet');
    git('config', 'user.name', 'Synthetic builder');
    git('config', 'user.email', 'builder@example.invalid');
    git('add', '.');
    git('commit', '--quiet', '-m', 'Synthetic initial revision');
    const first = tvBuildIdentity(root);
    assert.equal(first.modified, false);
    assert.equal(first.revision, git('rev-parse', 'HEAD'));
    writeFileSync(join(root, 'apps/tv/public/marker.txt'), 'Synthetic change');
    assert.equal(tvBuildIdentity(root).modified, true);
    git('add', '.');
    git('commit', '--quiet', '-m', 'Synthetic next revision');
    const next = tvBuildIdentity(root);
    assert.equal(next.modified, false);
    assert.notEqual(next.revision, first.revision);
    const script = fileURLToPath(new URL('./build-info.ts', import.meta.url));
    assert.deepEqual(
        JSON.parse(
            execFileSync(process.execPath, [script, '--cache-key'], {
                cwd: root,
                encoding: 'utf8',
            })
        ),
        next
    );
});
