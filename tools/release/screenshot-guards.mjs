/**
 * Fail-closed guards for the release screenshot capture
 * (capture-release-screenshots.ts). Published screenshots must never contain
 * a real playlist, credential, stream, or third-party artwork — these
 * helpers make that a property of the run, not a hope.
 *
 * Pure (or fs-only) so the policy is unit-tested; the Playwright driver just
 * wires them in.
 */

import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
} from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** The capture and the blog scaffold both assume exactly these themes. */
export const SUPPORTED_THEMES = ['dark', 'light'];

/**
 * Chromium switch applied at process start, so it has no install-timing
 * window at all: every hostname fails to resolve except the local mock. It
 * covers Chromium-stack traffic (renderer plus the main process `net`
 * module); requests made through Node's own stack are not affected, which is
 * why the session hook and the recorded-URL verdict still exist.
 */
export const HOST_RESOLVER_RULES =
    'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1';

/** Setup actions the driver implements. Manifest steps must match. */
export const KNOWN_ACTIONS = [
    'open-dashboard',
    'open-settings',
    'open-xtream-vod',
    'open-xtream-series',
    'open-m3u-groups',
    'open-add-playlist-xtream',
    'open-add-playlist-auto',
    'open-xtream-live',
    'open-add-playlist-stalker',
    'open-stalker-live',
    'open-add-playlist-m3u-url',
    'open-settings-epg',
    'open-downloads-manager',
    'open-downloads-offline-movie',
];

/**
 * Shots without a `group` belong to the release post and land in
 * `blog/<release>/screenshots/`. Any other group (for example `guides`) is
 * captured only when asked for with `--group` and lands in its own
 * `blog/<group>/screenshots/` directory, so a release run can never publish
 * guide frames into a release folder or the other way round.
 */
export const DEFAULT_SHOT_GROUP = 'release';

/** @param {{ group?: unknown }} shot */
export function shotGroup(shot) {
    return typeof shot?.group === 'string' ? shot.group : DEFAULT_SHOT_GROUP;
}

/**
 * @param {{ blogRoot: string, group: string, release: string }} input
 * @returns {string} the directory a run of `group` publishes into
 */
export function outputDirectoryFor({ blogRoot, group, release }) {
    const folder = group === DEFAULT_SHOT_GROUP ? release : group;

    return path.join(blogRoot, folder, 'screenshots');
}

/** @param {string} step e.g. `open-xtream-vod=Hero Premieres` */
export function parseSetupStep(step) {
    const separator = step.indexOf('=');
    const action = separator === -1 ? step : step.slice(0, separator);
    const param = separator === -1 ? null : step.slice(separator + 1);

    return { action, param };
}

/**
 * @param {object} manifest parsed screenshots.manifest.json
 * @returns {string[]} problems; empty when valid
 */
export function validateManifest(manifest) {
    const errors = [];

    if (manifest?.version !== 1) {
        errors.push('manifest `version` must be 1');
    }

    // The blog scaffold always references both `-dark.png` and `-light.png`,
    // and a full run publishes in replace mode — a manifest missing a theme
    // would silently delete the previous set and leave the post with broken
    // images.
    const themes = manifest?.themes;

    if (
        !Array.isArray(themes) ||
        themes.length !== SUPPORTED_THEMES.length ||
        SUPPORTED_THEMES.some((theme) => !themes.includes(theme))
    ) {
        errors.push(
            `manifest \`themes\` must be exactly ${SUPPORTED_THEMES.join(' and ')}, got ${JSON.stringify(themes)}`
        );
    }

    const shots = Array.isArray(manifest?.shots) ? manifest.shots : null;

    if (!shots || shots.length === 0) {
        return [...errors, 'manifest `shots` must be a non-empty array'];
    }

    const seen = new Set();

    for (const shot of shots) {
        const label = shot?.slug ?? '<missing slug>';

        if (!shot?.slug || !SLUG_PATTERN.test(shot.slug)) {
            errors.push(`shot "${label}": slug must be a lowercase slug`);
        }

        if (seen.has(shot?.slug)) {
            errors.push(`shot "${label}": duplicate slug`);
        }

        seen.add(shot?.slug);

        if (shot?.group !== undefined && !SLUG_PATTERN.test(String(shot.group))) {
            errors.push(`shot "${label}": group must be a lowercase slug`);
        }

        if (!Array.isArray(shot?.setup) || shot.setup.length === 0) {
            errors.push(`shot "${label}": setup must be a non-empty array`);
            continue;
        }

        for (const step of shot.setup) {
            const { action } = parseSetupStep(String(step));

            if (!KNOWN_ACTIONS.includes(action)) {
                errors.push(
                    `shot "${label}": unknown setup action "${action}" (expected ${KNOWN_ACTIONS.join(', ')})`
                );
            }
        }
    }

    return errors;
}

/**
 * A release slug names a directory under apps/website/public/blog, which a
 * full run replaces — including a recursive delete of what was there. Reject
 * anything that could escape that tree or resolve somewhere unexpected.
 *
 * @param {string} release
 * @returns {string | null} error message, or null when the slug is safe
 */
export function validateReleaseSlug(release) {
    if (!release) {
        return 'release slug is empty';
    }

    if (!/^[a-z0-9][a-z0-9.-]*$/.test(release) || release.includes('..')) {
        return `release slug "${release}" must be a lowercase slug without path separators (for example v0-24)`;
    }

    return null;
}

/** @returns {Set<string>} all slugs, for `.changes/` screenshot validation */
export function manifestSlugs(manifest) {
    return new Set((manifest?.shots ?? []).map((shot) => shot.slug));
}

/* ------------------------------------------------------------------ */
/* G2 — environment allowlist                                          */
/* ------------------------------------------------------------------ */

const ENV_ALLOWLIST = [
    'PATH',
    'HOME',
    'SHELL',
    'TMPDIR',
    'TZ',
    'LANG',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    // X11 sessions authenticate through an xauth cookie file; without it the
    // Electron child cannot open the display and the run dies before a window
    // exists. It grants display access, not application credentials.
    'XAUTHORITY',
];
const ENV_ALLOWED_PREFIXES = ['LC_', 'XDG_'];

/**
 * The capture app gets a constructed environment, never `...process.env`:
 * ambient variables are how TMDB keys, proxies, and experiment flags leak
 * into a run that must be hermetic.
 *
 * @param {Record<string, string | undefined>} baseEnv
 * @param {Record<string, string>} overrides explicit run configuration
 * @returns {Record<string, string>}
 */
export function buildCaptureEnv(baseEnv, overrides) {
    const env = {};

    for (const [key, value] of Object.entries(baseEnv)) {
        if (value === undefined) {
            continue;
        }

        if (
            ENV_ALLOWLIST.includes(key) ||
            ENV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
        ) {
            env[key] = value;
        }
    }

    return { ...env, ...overrides };
}

/* ------------------------------------------------------------------ */
/* G3 — network gate                                                   */
/* ------------------------------------------------------------------ */

/** Single source of truth for what may load during a capture run. */
export const ALLOWED_SCHEMES = [
    'file:',
    'data:',
    'blob:',
    'about:',
    'chrome:',
    'devtools:',
];
export const ALLOWED_HOSTS = ['localhost', '127.0.0.1'];
export const ALLOWED_NETWORK_PROTOCOLS = ['http:', 'ws:'];

/**
 * Deny by default. Only local mock traffic and the app's own bundle may load;
 * anything else (TMDB, logo CDNs, real streams) is blocked and — because the
 * caller fails on a non-empty list — fatal, since a silently blocked request
 * produces a frame that merely looks broken instead of unsafe.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedRequestUrl(url) {
    try {
        const { hostname, protocol } = new URL(url);

        if (ALLOWED_SCHEMES.includes(protocol)) {
            return true;
        }

        return (
            ALLOWED_NETWORK_PROTOCOLS.includes(protocol) &&
            ALLOWED_HOSTS.includes(hostname)
        );
    } catch {
        // `blob:file:///…` and similar opaque forms do not parse as URLs.
        return ALLOWED_SCHEMES.some((scheme) => url.startsWith(scheme));
    }
}

/**
 * App-level requests that are legitimate in production but must not leave
 * the machine during a capture run. The driver fulfills them locally with
 * an empty payload instead of letting them hit the network — a deterministic
 * stub, not an allowlist hole. Keep this list minimal and exact.
 *
 * @param {string} url
 * @returns {{ body: string, contentType: string } | null} stub response
 */
export const STUB_URL_PREFIXES = [
    // Settings "release notes" / update check.
    'https://api.github.com/repos/4gray/iptvnator/releases',
];

export function stubbedResponseFor(url) {
    if (STUB_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
        return { body: '[]', contentType: 'application/json' };
    }

    return null;
}

/**
 * Data handed to the main-process request hook, which cannot import this
 * module. Keeping the values here means the two predicates cannot disagree
 * about what is local even though the check itself is written twice.
 *
 * @returns {{ schemes: string[], hosts: string[], protocols: string[], stubPrefixes: string[] }}
 */
export function networkPolicy() {
    return {
        schemes: ALLOWED_SCHEMES,
        hosts: ALLOWED_HOSTS,
        protocols: ALLOWED_NETWORK_PROTOCOLS,
        stubPrefixes: STUB_URL_PREFIXES,
    };
}

/**
 * Publishes a staged frame set over the release directory as one swap.
 *
 * Copy-then-rename rather than moving file by file: staging lives in the
 * system temp directory, which may be a different filesystem (rename would
 * fail with EXDEV), and a per-file loop that fails midway would leave the
 * release holding a mix of new and old screenshots. Files are copied into a
 * sibling of the target — same filesystem, so the directory swap is atomic —
 * and the previous set is only deleted once the new one is in place.
 *
 * `mode` decides what happens to shots the staging set does not contain:
 * a full run replaces the directory so slugs dropped from the manifest do not
 * linger, while a filtered run (`--only`, `--theme`) must overlay its frames
 * onto the existing set — otherwise refreshing one shot would delete every
 * other screenshot of the release.
 *
 * @param {string} stagingDir
 * @param {string} outputRoot
 * @param {string} token unique suffix for the scratch directories
 * @param {{ mode?: 'replace' | 'merge', rename?: (from: string, to: string) => void }} [options]
 *   `rename` is a seam for exercising the rollback path, which the filesystem
 *   will not fail on demand
 * @returns {number} number of published files
 */
export function publishDirectory(
    stagingDir,
    outputRoot,
    token,
    { mode = 'replace', rename = renameSync } = {}
) {
    const incoming = `${outputRoot}.incoming-${token}`;
    const retired = `${outputRoot}.retired-${token}`;

    mkdirSync(path.dirname(outputRoot), { recursive: true });
    rmSync(incoming, { recursive: true, force: true });
    mkdirSync(incoming, { recursive: true });

    if (mode === 'merge' && existsSync(outputRoot)) {
        for (const name of readdirSync(outputRoot)) {
            const source = path.join(outputRoot, name);

            if (statSync(source).isFile()) {
                copyFileSync(source, path.join(incoming, name));
            }
        }
    }

    const names = readdirSync(stagingDir);

    for (const name of names) {
        copyFileSync(path.join(stagingDir, name), path.join(incoming, name));
    }

    const hadPrevious = existsSync(outputRoot);

    if (hadPrevious) {
        rename(outputRoot, retired);
    }

    try {
        rename(incoming, outputRoot);
    } catch (error) {
        if (hadPrevious) {
            rename(retired, outputRoot);
        }

        rmSync(incoming, { recursive: true, force: true });
        throw error;
    }

    rmSync(retired, { recursive: true, force: true });

    return names.length;
}

/**
 * Verdict over every request URL observed during a run — both the ones the
 * page-level route blocked and the ones the main-process recorder saw during
 * startup, before page interception exists.
 *
 * @param {string[]} urls
 * @returns {string[]} unique offending URLs; empty when the run stayed local
 */
export function externalRequestViolations(urls) {
    return [...new Set(urls)].filter(
        (url) => !isAllowedRequestUrl(url) && !stubbedResponseFor(url)
    );
}

/* ------------------------------------------------------------------ */
/* G4 — frame content assertions                                       */
/* ------------------------------------------------------------------ */

const CREDENTIAL_TEXT_PATTERNS = [
    /https?:\/\/[^\s"']*(?:username|password)=/i,
    /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i, // MAC address (Stalker identity)
    /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s"']+\.m3u8?\b/i,
];

/**
 * The one MAC address a published frame may show: the stalker-mock-server's
 * `marketing-demo` scenario. It exists only in the mock's scenario table, so
 * it identifies no real subscriber. Any other MAC-shaped text still fails the
 * shot, which is what keeps the Stalker guide screenshots from ever carrying
 * a real box identity.
 */
export const FICTIONAL_STALKER_MAC = '00:1A:79:00:00:07';

/**
 * Evaluated against a DOM report collected right before each screenshot:
 * every image/background URL and the visible text. External resources or
 * credential-shaped text fail the shot.
 *
 * @param {{ resourceUrls: string[], bodyText: string }} report
 * @returns {string[]} violations; empty when the frame is safe
 */
export function evaluateFrameReport(report) {
    const violations = [];

    for (const url of report.resourceUrls) {
        if (!isAllowedRequestUrl(url)) {
            violations.push(`external resource in frame: ${url}`);
        }
    }

    const bodyText = report.bodyText
        .split(FICTIONAL_STALKER_MAC)
        .join('[fictional-mac]');

    for (const pattern of CREDENTIAL_TEXT_PATTERNS) {
        const match = bodyText.match(pattern);

        if (match) {
            violations.push(
                `credential-shaped text visible in frame: "${match[0].slice(0, 80)}"`
            );
        }
    }

    return violations;
}

/* ------------------------------------------------------------------ */
/* G1 — real database untouched                                        */
/* ------------------------------------------------------------------ */

/**
 * Snapshots every file in the real database directory — `iptvnator.db` plus
 * its SQLite WAL sidecars (`-wal`, `-shm`), where writes live until a
 * checkpoint, so a mutation cannot hide in them.
 *
 * Identity is size + mtime + inode, deliberately not a content hash: the
 * production database is multi-gigabyte, and the previous `readFileSync` +
 * sha256 approach threw on it and was swallowed into "file does not exist" —
 * which silently disabled this guard entirely. Only ENOENT means absent; any
 * other error propagates.
 *
 * @param {string} directory
 * @returns {{ exists: boolean, entries: Record<string, {size: number, mtimeMs: number, ino: number}> }}
 */
export function snapshotDatabaseState(directory) {
    let names;

    try {
        names = readdirSync(directory);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { exists: false, entries: {} };
        }

        throw error;
    }

    const entries = {};

    for (const name of names.sort()) {
        try {
            const stats = statSync(path.join(directory, name));

            if (stats.isFile()) {
                entries[name] = {
                    size: stats.size,
                    mtimeMs: stats.mtimeMs,
                    ino: stats.ino,
                };
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    return { exists: true, entries };
}

/**
 * @returns {string | null} violation message, or null when unchanged
 */
export function compareDatabaseStates(before, after) {
    if (before.exists !== after.exists) {
        return before.exists
            ? 'the real database directory disappeared during the capture run'
            : 'the real database directory was CREATED during the capture run';
    }

    if (!before.exists) {
        return null;
    }

    const names = new Set([
        ...Object.keys(before.entries),
        ...Object.keys(after.entries),
    ]);

    for (const name of [...names].sort()) {
        const from = before.entries[name];
        const to = after.entries[name];

        if (!from) {
            return `the real database gained ${name} during the capture run`;
        }

        if (!to) {
            return `the real database lost ${name} during the capture run`;
        }

        if (
            from.size !== to.size ||
            from.mtimeMs !== to.mtimeMs ||
            from.ino !== to.ino
        ) {
            return `the real database file ${name} was modified during the capture run (close IPTVnator and any other process using it, then retry)`;
        }
    }

    return null;
}
