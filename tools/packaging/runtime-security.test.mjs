import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parse } from 'yaml';

const rootUrl = new URL('../../', import.meta.url);
const root = fileURLToPath(rootUrl);
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), 'utf8');

// Security floors from the October 2026 Node release, independent of the
// package specifier: a valid Electron version can still bundle an unsafe Node.
function assertPatchedNode(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    const floor = { 22: [23, 4], 24: [22, 1], 26: [12, 1] }[major];
    assert.ok(
        floor &&
            (minor > floor[0] || (minor === floor[0] && patch >= floor[1])),
        `Node ${version} predates the October 2026 security fixes`
    );
}

test('development and actual Electron binary use patched Node runtimes', () => {
    assertPatchedNode(process.versions.node);
    const result = spawnSync(
        require('electron'),
        ['-p', 'JSON.stringify(process.versions)'],
        {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            encoding: 'utf8',
            timeout: 30_000,
        }
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const versions = JSON.parse(result.stdout);
    assert.equal(versions.electron, require('electron/package.json').version);
    assertPatchedNode(versions.node);
});

test('Docker stages and CI select the repository Node version', () => {
    const version = read('.nvmrc').trim();
    assertPatchedNode(version);
    const dockerfile = read('docker/Dockerfile');
    assert.ok(dockerfile.includes(`ARG NODE_VERSION=${version}\n`));
    const stages = dockerfile.match(/^FROM .+$/gm);
    assert.equal(stages.length, 3);
    assert.ok(
        stages.every((stage) => stage.includes('node:${NODE_VERSION}-alpine'))
    );
    for (const name of readdirSync(`${root}.github/workflows`)) {
        if (!/\.ya?ml$/.test(name)) continue;
        const workflow = parse(read(`.github/workflows/${name}`));
        for (const job of Object.values(workflow.jobs ?? {})) {
            for (const step of job.steps ?? []) {
                if (!step.uses?.startsWith('actions/setup-node@')) continue;
                assert.equal(step.with?.['node-version-file'], '.nvmrc', name);
                assert.equal(step.with?.['node-version'], undefined, name);
            }
        }
    }
});

// CVE-2026-111181: the gzip decoder finishes a valid frame before processing
// the trailing data. Isolate Express so a regression cannot crash the runner.
const compressedRequestServer = `
    const express = require('express');
    const app = express();
    app.post('/', express.json(), (_req, res) => res.json({ ok: true }));
    app.get('/health', (_req, res) => res.send('healthy'));
    const server = app.listen(0, '127.0.0.1', () => {
        process.send({ port: server.address().port });
    });
`;

test(
    'Express survives trailing bytes after a compressed JSON frame',
    {
        timeout: 10_000,
    },
    async (t) => {
        const child = spawn(process.execPath, ['-e', compressedRequestServer], {
            cwd: root,
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', (chunk) => {
            stderr += chunk;
        });
        t.after(async () => {
            if (child.exitCode === null && child.signalCode === null) {
                const exited = once(child, 'exit');
                child.kill();
                await exited;
            }
        });
        const [{ port }] = await once(child, 'message', {
            signal: AbortSignal.timeout(5_000),
        });
        const socket = connect(port, '127.0.0.1');
        t.after(() => socket.destroy());
        socket.on('error', () => {
            // A vulnerable child can reset the socket; its exit is asserted below.
        });
        await once(socket, 'connect');
        let response = '';
        const responded = new Promise((resolve) => {
            socket.on('data', (chunk) => {
                response += chunk.toString();
                if (response.includes('{"ok":true}')) resolve();
            });
        });
        const body = Buffer.concat([
            gzipSync('{"value":1}'),
            Buffer.from([0]),
            Buffer.alloc(100 * 1024, 0x58),
        ]);
        socket.write(
            'POST / HTTP/1.1\r\nHost: localhost\r\n' +
                'Content-Type: application/json\r\nContent-Encoding: gzip\r\n' +
                `Content-Length: ${body.length}\r\n\r\n`
        );
        socket.write(body);
        await Promise.race([
            responded,
            once(child, 'exit').then(() => assert.fail(stderr)),
        ]);
        await delay(100);
        assert.equal(child.exitCode, null, stderr);
        const health = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(2_000),
        });
        assert.equal(await health.text(), 'healthy');
    }
);
