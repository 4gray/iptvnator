/*
 * Linux/Windows frame-copy probe: spawns iptvnator_mpv_helper, attaches the
 * embedded_mpv_frame_reader addon to the announced shm generation, and
 * reports producer fps, copy latency (ageMs), copy wall time, torn reads
 * and pixel spread. Usage:
 *   node frame-probe.mjs <url> <width> <height> <seconds> [--hwdec auto]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const releaseDir = process.env.RELEASE_DIR;
const [url, width = '1280', height = '720', seconds = '5', ...rest] =
    process.argv.slice(2);
if (!url || !releaseDir) {
    console.error('usage: RELEASE_DIR=<native build dir> node frame-probe.mjs <url> [w] [h] [s]');
    process.exit(1);
}
const hwdecIdx = rest.indexOf('--hwdec');
const hwdec = hwdecIdx >= 0 ? rest[hwdecIdx + 1] : null;

const reader = require(path.join(releaseDir, 'embedded_mpv_frame_reader.node'));
const helperPath = path.join(
    releaseDir,
    process.platform === 'win32'
        ? 'iptvnator_mpv_helper.exe'
        : 'iptvnator_mpv_helper'
);
const shmBase = `/impv-probe-${process.pid}`;

const args = ['--shm-base', shmBase, '--width', width, '--height', height];
if (hwdec) args.push('--hwdec', hwdec);
const child = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'inherit'] });

let buffer = '';
let currentSource = null;
const generations = [];
let statusLog = [];

child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.event === 'shm') {
            generations.push(`${ev.name} ${ev.width}x${ev.height}`);
            currentSource = ev;
        } else if (ev.event === 'snapshot') {
            if (statusLog[statusLog.length - 1] !== ev.status) statusLog.push(ev.status);
        } else if (ev.event === 'fatal') {
            console.error('FATAL:', ev.error);
            process.exit(2);
        }
    }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Poll yield between latestSeq checks: Windows quantizes setTimeout to the
 * ~15.6 ms system timer, which would dominate ageMs; setImmediate keeps the
 * poll sub-ms there at the cost of one busy event loop. */
const pollYield =
    process.platform === 'win32'
        ? () => new Promise((r) => setImmediate(r))
        : () => sleep(2);

await sleep(300);
child.stdin.write(`load\turl=${url.replace(/%/g, '%25')}\n`);

// Wait for playback + a possibly-resized generation to settle.
const settleDeadline = Date.now() + 10000;
while (Date.now() < settleDeadline) {
    await sleep(100);
    if (statusLog.includes('playing') && currentSource) {
        await sleep(700); // allow the aspect-fit resize generation to land
        break;
    }
}
if (!currentSource) {
    console.error('no shm source announced');
    child.kill('SIGKILL');
    process.exit(2);
}

const info = reader.open(currentSource.name);
console.log(`attached ${currentSource.name}: ${info.width}x${info.height} stride=${info.stride} gen=${info.generation}`);

const frameBuf = new ArrayBuffer(info.frameBytes);
let lastSeq = 0;
let frames = 0;
let torn = 0;
const ages = [];
const copyTimes = [];
const durationMs = Number(seconds) * 1000;
const start = Date.now();
let pixelMin = 255, pixelMax = 0;

while (Date.now() - start < durationMs) {
    const seq = reader.latestSeq();
    if (seq !== lastSeq) {
        const t0 = process.hrtime.bigint();
        const result = reader.copyLatest(frameBuf);
        const t1 = process.hrtime.bigint();
        if (result) {
            frames += 1;
            lastSeq = result.seq;
            ages.push(result.ageMs);
            copyTimes.push(Number(t1 - t0) / 1e6);
            if (result.torn) torn += 1;
        }
    }
    await pollYield();
}
const elapsed = (Date.now() - start) / 1000;

// pixel spread over the last frame
const view = new Uint8Array(frameBuf);
for (let i = 0; i < view.length; i += 4001 * 4) {
    for (let c = 0; c < 3; c++) {
        const v = view[i + c];
        if (v < pixelMin) pixelMin = v;
        if (v > pixelMax) pixelMax = v;
    }
}

const pct = (arr, p) => {
    if (!arr.length) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

console.log(`generations seen: ${generations.join(' | ')}`);
console.log(`status transitions: ${statusLog.join(' -> ')}`);
console.log(`producerAliveMs: ${reader.producerAliveMs().toFixed(1)}`);
console.log(`new frames: ${frames} in ${elapsed.toFixed(1)}s = ${(frames / elapsed).toFixed(1)} fps`);
console.log(`copy ms avg/p95: ${avg(copyTimes).toFixed(2)} / ${pct(copyTimes, 0.95).toFixed(2)}`);
console.log(`age ms avg/p95: ${avg(ages).toFixed(2)} / ${pct(ages, 0.95).toFixed(2)}`);
console.log(`torn: ${torn}`);
console.log(`pixel spread (BGR sampled): min=${pixelMin} max=${pixelMax}`);

child.stdin.write('quit\n');
child.stdin.end();
await sleep(500);
if (child.exitCode === null) child.kill('SIGKILL');
reader.close();
