/**
 * Release screenshot capture, manifest-driven and fail-closed.
 *
 *   pnpm release:screenshots                      # release slug from package.json
 *   pnpm release:screenshots --release v0-24      # explicit
 *   pnpm release:screenshots --only dashboard --theme dark
 *
 * Reads tools/release/screenshots.manifest.json and writes
 * apps/website/public/blog/<release>/screenshots/<slug>-<theme>.png against
 * dist builds + the xtream mock server. Guards (screenshot-guards.mjs):
 *
 *   G1  the real ~/.iptvnator/databases directory — including the SQLite WAL
 *       sidecars, compared after Electron exits and checkpoints — is proven
 *       untouched
 *   G2  the app gets an allowlisted environment, never ...process.env
 *   G3  a main-process recorder (installed before the renderer boots) plus a
 *       page-level deny-by-default route; any external attempt fails the run
 *   G4  every frame is checked for external resources / credential text
 *   G5  TMDB stays disabled (fresh profile default, asserted via IndexedDB)
 *
 * Frames are staged outside the repository and published only after every
 * shot and every guard has passed, so a failure can neither leave unsafe
 * frames behind nor destroy previously committed release assets.
 */

import {
    accessSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { Page } from '@playwright/test';

import {
    buildCaptureEnv,
    compareDatabaseStates,
    evaluateFrameReport,
    externalRequestViolations,
    isAllowedRequestUrl,
    parseSetupStep,
    snapshotDatabaseState,
    stubbedResponseFor,
    validateManifest,
} from './screenshot-guards.mjs';
import * as driver from './capture-app-driver';
import { applyTheme, runAction, settleUi } from './capture-navigation';

type Theme = 'dark' | 'light';

const workspaceRoot = process.cwd();
const manifestPath = path.join(
    workspaceRoot,
    'tools/release/screenshots.manifest.json'
);
const electronMainPath = path.join(
    workspaceRoot,
    'dist/apps/electron-backend/main.js'
);
const realDbDir = path.join(homedir(), '.iptvnator/databases');

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
    const index = args.indexOf(`--${name}`);

    return index !== -1 ? (args[index + 1] ?? null) : null;
};

const blockedRequests: string[] = [];

async function main(): Promise<void> {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const manifestErrors = validateManifest(manifest);

    if (manifestErrors.length > 0) {
        throw new Error(`Invalid manifest:\n  ${manifestErrors.join('\n  ')}`);
    }

    const release =
        flag('release') ?? `v${readAppVersion().split('.').slice(0, 2).join('-')}`;
    const only = flag('only');
    const themeFilter = flag('theme') as Theme | null;
    const shots = manifest.shots.filter(
        (shot: { slug: string }) => !only || shot.slug === only
    );

    if (shots.length === 0) {
        throw new Error(`--only ${only} matches no manifest slug`);
    }

    const themes: Theme[] = themeFilter ? [themeFilter] : manifest.themes;
    const outputRoot = path.join(
        workspaceRoot,
        `apps/website/public/blog/${release}/screenshots`
    );

    assertBuiltRuntime();

    // G1: snapshot the real database directory BEFORE anything launches.
    const dbBefore = snapshotDatabaseState(realDbDir);

    // Frames are staged outside the repo and published only once every shot
    // and every guard has passed, so a late failure can never destroy the
    // release assets an earlier run already committed.
    const stagingDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-shots-'));
    const mockServer = await driver.ensureXtreamMockServer(workspaceRoot);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-release-shots-'));
    let app: Awaited<ReturnType<typeof driver.launchApp>> | undefined;
    let recordedRequests: string[] = [];
    let captured = 0;

    try {
        // G2: constructed environment — nothing ambient crosses over.
        app = await driver.launchApp(
            electronMainPath,
            buildCaptureEnv(process.env, {
                ELECTRON_IS_DEV: '0',
                IPTVNATOR_E2E_DATA_DIR: dataDir,
                NODE_ENV: 'test',
            })
        );

        // G3, first layer: a main-process recorder, installed before the
        // renderer can boot. Page-level routing only exists once a page
        // handle is obtained, so startup requests would otherwise escape
        // observation entirely.
        await installRequestRecorder(app);

        const page = await driver.findMainWindow(app);

        // G3, second layer: page-level deny-by-default, which also blocks.
        await page.route('**/*', async (route) => {
            const url = route.request().url();

            if (isAllowedRequestUrl(url)) {
                await route.continue();
                return;
            }

            // Known app-level calls are answered locally so the run stays
            // hermetic without failing on legitimate app behavior.
            const stub = stubbedResponseFor(url);

            if (stub) {
                await route.fulfill({
                    body: stub.body,
                    contentType: stub.contentType,
                });
                return;
            }

            blockedRequests.push(url);
            await route.abort();
        });

        await driver.sizeWindow(app, manifest.viewport);
        await driver.waitForAppReady(page);
        await assertTmdbDisabled(page); // G5
        await driver.seedDemoData(page, driver.writeM3uFixture(dataDir));

        for (const theme of themes) {
            await applyTheme(page, theme);

            for (const shot of shots) {
                for (const step of shot.setup) {
                    const { action, param } = parseSetupStep(String(step));
                    await runAction(page, action, param);
                }

                await captureShot(page, stagingDir, shot.slug, theme);
                captured += 1;
            }
        }

        recordedRequests = await drainRecordedRequests(app);

        // A recorder that observes nothing is indistinguishable from a
        // passing run, which is how a guard silently stops guarding. The
        // renderer always loads its own bundle, so an empty log means the
        // hook is not wired up.
        assertSync(
            recordedRequests.length > 0,
            'G3 failed: the main-process request recorder observed no traffic at all — it is not wired up, so startup requests would go unchecked'
        );

        // G3: an attempted external request means a fixture is wrong, not
        // that we got away with it.
        const external = externalRequestViolations([
            ...blockedRequests,
            ...recordedRequests,
        ]);

        if (external.length > 0) {
            throw new Error(
                `G3 failed: ${external.length} external request(s) were attempted:\n  ${external
                    .slice(0, 15)
                    .join('\n  ')}`
            );
        }

        assertSync(
            snapshotDatabaseState(path.join(dataDir, 'databases')).exists,
            'G1 failed: the isolated database was never created — the app did not honor IPTVNATOR_E2E_DATA_DIR'
        );
    } finally {
        // Close before the G1 comparison: SQLite runs in WAL mode, so writes
        // may sit in -wal until the worker shuts down and checkpoints.
        await app?.close().catch(() => undefined);
        mockServer?.kill('SIGTERM');
        rmSync(dataDir, { recursive: true, force: true });
    }

    const dbViolation = compareDatabaseStates(
        dbBefore,
        snapshotDatabaseState(realDbDir)
    );

    if (dbViolation) {
        throw new Error(`G1 failed: ${dbViolation}`);
    }

    publishFrames(stagingDir, outputRoot);
    console.log(
        `Captured ${captured} screenshot(s) into ${path.relative(workspaceRoot, outputRoot)}`
    );
    console.log(
        `Guards passed: ${new Set(recordedRequests).size} distinct request(s) observed, all local.`
    );
}

/**
 * Records every request URL the Electron session sees, from before the
 * renderer boots. Recording only — blocking stays with the page-level route,
 * so the two layers cannot disagree about what was served.
 */
async function installRequestRecorder(
    app: Awaited<ReturnType<typeof driver.launchApp>>
): Promise<void> {
    await app.evaluate(({ session }) => {
        const store: string[] = [];

        (globalThis as unknown as { __captureRequests: string[] })
            .__captureRequests = store;

        session.defaultSession.webRequest.onBeforeRequest(
            (details, callback) => {
                store.push(details.url);
                callback({ cancel: false });
            }
        );
    });
}

async function drainRecordedRequests(
    app: Awaited<ReturnType<typeof driver.launchApp>>
): Promise<string[]> {
    return app.evaluate(
        () =>
            (globalThis as unknown as { __captureRequests?: string[] })
                .__captureRequests ?? []
    );
}

/** Atomically-ish moves staged frames into the published location. */
function publishFrames(stagingDir: string, outputRoot: string): void {
    mkdirSync(outputRoot, { recursive: true });

    for (const name of readdirSync(stagingDir)) {
        renameSync(path.join(stagingDir, name), path.join(outputRoot, name));
    }

    rmSync(stagingDir, { recursive: true, force: true });
}

async function captureShot(
    page: Page,
    outputRoot: string,
    slug: string,
    theme: Theme
): Promise<void> {
    await settleUi(page);

    // G4: inspect the frame before trusting it.
    const report = await page.evaluate(() => {
        const urls = new Set<string>();

        document.querySelectorAll('img[src]').forEach((img) => {
            urls.add((img as HTMLImageElement).src);
        });
        document.querySelectorAll<HTMLElement>('*').forEach((element) => {
            const background = getComputedStyle(element).backgroundImage;
            const match = background?.match(/url\("?([^")]+)"?\)/);

            if (match) {
                urls.add(match[1]);
            }
        });

        return {
            resourceUrls: [...urls],
            bodyText: document.body.innerText,
        };
    });

    const violations = evaluateFrameReport(report);

    if (violations.length > 0) {
        throw new Error(
            `G4 failed on ${slug} (${theme}):\n  ${violations.join('\n  ')}`
        );
    }

    await page.screenshot({
        path: path.join(outputRoot, `${slug}-${theme}.png`),
        type: 'png',
    });
    console.log(`  ✓ ${slug} (${theme})`);
}

/**
 * G5: settings live in the renderer's IndexedDB (ngx-pwa StorageMap). A
 * fresh profile has no entry, which means the TMDB defaults (disabled,
 * empty key) apply. Read-only assertion — if a future change flips the
 * default or seeds a key, the run stops before a licensed poster can render.
 */
async function assertTmdbDisabled(page: Page): Promise<void> {
    const tmdb = await page.evaluate(
        () =>
            new Promise<{ enabled?: boolean; apiKey?: string } | null>(
                (resolve) => {
                    const request = indexedDB.open('ngStorage');

                    request.onerror = () => resolve(null);
                    request.onsuccess = () => {
                        const db = request.result;

                        if (!db.objectStoreNames.contains('localStorage')) {
                            resolve(null);
                            return;
                        }

                        const get = db
                            .transaction('localStorage')
                            .objectStore('localStorage')
                            .get('settings');

                        get.onerror = () => resolve(null);
                        get.onsuccess = () =>
                            resolve(
                                (get.result as { tmdb?: { enabled?: boolean; apiKey?: string } })
                                    ?.tmdb ?? null
                            );
                    };
                }
            )
    );

    assertSync(
        !tmdb?.enabled && !tmdb?.apiKey,
        `G5 failed: TMDB enrichment is active in the capture profile (${JSON.stringify(tmdb)})`
    );
}

function assertBuiltRuntime(): void {
    for (const required of [
        electronMainPath,
        path.join(workspaceRoot, 'dist/apps/web/index.html'),
    ]) {
        try {
            accessSync(required);
        } catch {
            throw new Error(
                `Built runtime missing: ${required}\nBuild it first: pnpm nx run electron-backend:build-e2e`
            );
        }
    }
}

function readAppVersion(): string {
    return JSON.parse(
        readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')
    ).version;
}

function assertSync(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
