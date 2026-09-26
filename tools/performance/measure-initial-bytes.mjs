/**
 * Measures the bytes a browser fetches before the Angular app can bootstrap:
 * `index.html` itself plus every same-origin script, stylesheet and
 * `modulepreload` chunk it references. This is the J1 ("launch to usable")
 * counter `renderer.initialBytes` from docs/architecture/performance-journeys.md.
 *
 * The number is read from the built output, not estimated from source, so it
 * is deterministic for a given build and can be ratcheted in CI.
 *
 * Usage:
 *   node tools/performance/measure-initial-bytes.mjs [--dist dist/apps/web]
 *       [--json] [--summary dist/performance/journey-summary.json]
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIST_DIR = 'dist/apps/web';
export const INITIAL_BYTES_COUNTER = 'renderer.initialBytes';
export const LAUNCH_JOURNEY = 'launch';

const TAG_PATTERN = /<(script|link)\b([^>]*)>/gi;
const ATTRIBUTE_PATTERN =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const EXTERNAL_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function parseAttributes(raw) {
    const attributes = {};
    for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
        const [, name, doubleQuoted, singleQuoted, bare] = match;
        attributes[name.toLowerCase()] =
            doubleQuoted ?? singleQuoted ?? bare ?? '';
    }
    return attributes;
}

/**
 * A resource only counts when the browser fetches it on the initial path from
 * the same origin. Manifest, icons and external URLs are not part of the
 * payload the ratchet guards: icons load lazily, and external hosts are
 * outside the build's control.
 */
function classify(tag, attributes) {
    if (tag === 'script') {
        return attributes.src ? { kind: 'script', url: attributes.src } : null;
    }
    const rel = (attributes.rel ?? '').toLowerCase().split(/\s+/);
    if (!attributes.href) return null;
    if (rel.includes('stylesheet')) {
        return { kind: 'stylesheet', url: attributes.href };
    }
    if (rel.includes('modulepreload')) {
        return { kind: 'modulepreload', url: attributes.href };
    }
    return null;
}

/**
 * Lists the same-origin resources `index.html` puts on the initial path, in
 * document order. Duplicates are collapsed by request URL, not by file: the
 * browser fetches `chunk.js?v=1` and `chunk.js?v=2` separately, so both count,
 * while a fragment never reaches the server and is ignored. `path` is the
 * file on disk the URL maps to.
 */
export function extractInitialResources(html) {
    const seen = new Set();
    const resources = [];
    for (const [, tag, rawAttributes] of html.matchAll(TAG_PATTERN)) {
        const resource = classify(
            tag.toLowerCase(),
            parseAttributes(rawAttributes)
        );
        if (!resource || EXTERNAL_URL.test(resource.url)) continue;
        const url = resource.url.replace(/#.*$/, '').replace(/^\.?\//, '');
        const file = url.replace(/\?.*$/, '');
        if (!file || seen.has(url)) continue;
        seen.add(url);
        resources.push({ path: file, url, kind: resource.kind });
    }
    return resources;
}

async function sizeOf(filePath) {
    const stats = await stat(filePath);
    return stats.size;
}

/**
 * Reads the built output and returns the per-file breakdown plus the counter
 * value. Missing files are an error rather than zero bytes: a broken reference
 * would otherwise look like a bundle-size win.
 */
export async function measureInitialBytes({ distDir, readSize = sizeOf }) {
    const indexPath = path.join(distDir, 'index.html');
    if (!existsSync(indexPath)) {
        throw new Error(
            `No index.html under ${distDir}. Build the web app first (pnpm nx build web).`
        );
    }
    const html = await readFile(indexPath, 'utf8');
    const indexBytes = await readSize(indexPath);
    const resources = [];
    const missing = [];

    for (const resource of extractInitialResources(html)) {
        const absolute = path.join(distDir, resource.path);
        if (!existsSync(absolute)) {
            missing.push(resource.path);
            continue;
        }
        resources.push({ ...resource, bytes: await readSize(absolute) });
    }

    if (missing.length > 0) {
        throw new Error(
            `index.html references files that are not in ${distDir}: ${missing.join(', ')}`
        );
    }

    const totals = {
        indexHtml: indexBytes,
        script: 0,
        stylesheet: 0,
        modulepreload: 0,
    };
    for (const resource of resources) totals[resource.kind] += resource.bytes;
    const initialBytes =
        totals.indexHtml +
        totals.script +
        totals.stylesheet +
        totals.modulepreload;

    return {
        distDir,
        indexHtml: { path: 'index.html', bytes: indexBytes },
        resources,
        totals: { ...totals, initialBytes },
        counters: { [INITIAL_BYTES_COUNTER]: initialBytes },
    };
}

/** The journey summary shape consumed by check-journey-ratchet.mjs. */
export function toJourneySummary(
    measurement,
    { measuredAt = new Date() } = {}
) {
    return {
        version: 1,
        measuredAt: measuredAt.toISOString(),
        journeys: {
            [LAUNCH_JOURNEY]: {
                counters: { ...measurement.counters },
            },
        },
    };
}

function formatBytes(bytes) {
    return bytes.toLocaleString('en-US');
}

export function formatReport(measurement) {
    const rows = [...measurement.resources].sort((a, b) => b.bytes - a.bytes);
    const width = Math.max(
        ...rows.map((row) => row.url.length),
        'index.html'.length
    );
    const lines = [
        `Initial payload of ${measurement.distDir}`,
        '',
        `${'index.html'.padEnd(width)}  html           ${formatBytes(measurement.indexHtml.bytes).padStart(11)}`,
        ...rows.map(
            (row) =>
                `${row.url.padEnd(width)}  ${row.kind.padEnd(13)}  ${formatBytes(row.bytes).padStart(11)}`
        ),
        '',
        `scripts        ${formatBytes(measurement.totals.script).padStart(11)}`,
        `stylesheets    ${formatBytes(measurement.totals.stylesheet).padStart(11)}`,
        `modulepreload  ${formatBytes(measurement.totals.modulepreload).padStart(11)}`,
        `${INITIAL_BYTES_COUNTER} = ${formatBytes(measurement.totals.initialBytes)} bytes (${measurement.resources.length} files + index.html)`,
    ];
    return lines.join('\n');
}

export function parseArgs(argv) {
    const options = { distDir: DEFAULT_DIST_DIR, json: false, summary: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--') continue;
        if (argument === '--json') {
            options.json = true;
        } else if (argument === '--dist') {
            options.distDir = argv[++index];
        } else if (argument.startsWith('--dist=')) {
            options.distDir = argument.slice('--dist='.length);
        } else if (argument === '--summary') {
            options.summary = argv[++index];
        } else if (argument.startsWith('--summary=')) {
            options.summary = argument.slice('--summary='.length);
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
        if (options.distDir === undefined || options.summary === undefined) {
            throw new Error(`Missing value for ${argument}`);
        }
    }
    return options;
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const measurement = await measureInitialBytes({
            distDir: path.resolve(options.distDir),
        });
        measurement.distDir =
            path.relative(process.cwd(), measurement.distDir) || '.';

        if (options.summary) {
            const summaryPath = path.resolve(options.summary);
            await mkdir(path.dirname(summaryPath), { recursive: true });
            await writeFile(
                summaryPath,
                `${JSON.stringify(toJourneySummary(measurement), null, 4)}\n`
            );
        }

        console.log(
            options.json
                ? JSON.stringify(measurement, null, 4)
                : formatReport(measurement)
        );
        if (options.summary && !options.json) {
            console.log(`\nJourney summary written to ${options.summary}`);
        }
    } catch (error) {
        console.error(`measure-initial-bytes: ${error.message}`);
        process.exitCode = 1;
    }
}
