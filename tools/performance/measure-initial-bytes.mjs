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

const OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/;
/**
 * Elements whose body the HTML tokenizer reads as text up to the matching end
 * tag: raw text (script, style, xmp, iframe, noembed, noframes), escapable raw
 * text (textarea, title) and, with scripting enabled as it is in every
 * browser that can bootstrap Angular, noscript. Nothing inside them is a tag.
 */
const RAW_TEXT_ELEMENTS = new Set([
    'script',
    'style',
    'noscript',
    'textarea',
    'title',
    'xmp',
    'iframe',
    'noembed',
    'noframes',
]);
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
 * Walks the document once, the way a tokenizer does, and yields the opening
 * tags the browser would actually see: an HTML comment is skipped as a unit
 * (a commented-out `<script>` is not a request), and the body of a `<script>`
 * or `<style>` element is skipped up to its closing tag (a string literal that
 * looks like a tag, or a `<!--` inside a script, is not markup). Regex
 * replacement cannot get this right, because comment markers inside raw text
 * and raw-text markers inside comments have to be resolved in document order.
 */
/**
 * An end tag closes raw text only when the exact name is followed by
 * whitespace, `/` or `>`: `</scriptlet>` inside a script is still script.
 */
function findEndTag(lower, name, from) {
    const needle = `</${name}`;
    let at = lower.indexOf(needle, from);
    while (at !== -1) {
        const next = lower[at + needle.length];
        if (next === undefined || /[\s/>]/.test(next)) return at;
        at = lower.indexOf(needle, at + 1);
    }
    return -1;
}

export function scanLiveTags(html) {
    const lower = html.toLowerCase();
    const tags = [];
    let index = 0;
    while (index < html.length) {
        const lt = html.indexOf('<', index);
        if (lt === -1) break;
        if (html.startsWith('<!--', lt)) {
            const close = html.indexOf('-->', lt + 4);
            index = close === -1 ? html.length : close + 3;
            continue;
        }
        if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
            // Doctype, CDATA or a "bogus comment": the tokenizer swallows it
            // up to the next '>' and nothing inside it is a tag.
            const close = html.indexOf('>', lt + 2);
            index = close === -1 ? html.length : close + 1;
            continue;
        }
        const match = OPEN_TAG.exec(html.slice(lt, lt + 4096));
        if (!match) {
            index = lt + 1;
            continue;
        }
        const name = match[1].toLowerCase();
        const afterTag = lt + match[0].length;
        if (name === 'script' || name === 'link') {
            tags.push({ tag: name, rawAttributes: match[2] });
        }
        if (RAW_TEXT_ELEMENTS.has(name)) {
            const closeTag = findEndTag(lower, name, afterTag);
            if (closeTag === -1) break;
            const closeEnd = lower.indexOf('>', closeTag);
            index = closeEnd === -1 ? html.length : closeEnd + 1;
            continue;
        }
        index = afterTag;
    }
    return tags;
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
    for (const { tag, rawAttributes } of scanLiveTags(html)) {
        const resource = classify(tag, parseAttributes(rawAttributes));
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
