/**
 * Release screenshot capture, manifest-driven and fail-closed.
 *
 *   pnpm release:screenshots                      # release slug from package.json
 *   pnpm release:screenshots --release v0-24      # explicit
 *   pnpm release:screenshots --only dashboard --theme dark
 *   pnpm release:screenshots --group guides       # evergreen guide shots
 *
 * Reads tools/release/screenshots.manifest.json and writes
 * apps/website/public/blog/<release>/screenshots/<slug>-<theme>.png against
 * dist builds + the xtream mock server. Shots carrying a `group` (for
 * example `guides`) are skipped by a release run and land in
 * apps/website/public/blog/<group>/screenshots/ when that group is selected.
 * Guards (screenshot-guards.mjs):
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

import { accessSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { Page } from '@playwright/test';

import {
    DEFAULT_SHOT_GROUP,
    buildCaptureEnv,
    compareDatabaseStates,
    evaluateFrameReport,
    externalRequestViolations,
    HOST_RESOLVER_RULES,
    isAllowedRequestUrl,
    networkPolicy,
    outputDirectoryFor,
    parseSetupStep,
    publishDirectory,
    shotGroup,
    snapshotDatabaseState,
    stubbedResponseFor,
    validateManifest,
    validateReleaseSlug,
} from './screenshot-guards.mjs';
import * as driver from './capture-app-driver';
import { applyTheme, runAction, settleUi } from './capture-navigation';
import { assertTmdbDisabled } from './capture-tmdb-check';
import {
    drainRecordedRequests,
    installRequestRecorder,
} from './capture-network-gate';

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
    const releaseError = validateReleaseSlug(release);

    if (releaseError) {
        throw new Error(`--release rejected: ${releaseError}`);
    }

    const group = flag('group') ?? DEFAULT_SHOT_GROUP;
    const groupError = validateReleaseSlug(group);

    if (groupError) {
        throw new Error(`--group rejected: ${groupError}`);
    }

    const only = flag('only');
    const themeFilter = flag('theme');
    const shots = manifest.shots.filter(
        (shot: { slug: string; group?: string }) =>
            shotGroup(shot) === group && (!only || shot.slug === only)
    );

    if (shots.length === 0) {
        throw new Error(
            only
                ? `--only ${only} matches no manifest slug in group ${group}`
                : `--group ${group} matches no manifest shots`
        );
    }

    // Without this an erased cast would accept `--theme --only`, and every
    // non-`dark` value silently renders as light into a misnamed file.
    if (themeFilter && !manifest.themes.includes(themeFilter)) {
        throw new Error(
            `--theme "${themeFilter}" is not one of ${manifest.themes.join(', ')}`
        );
    }

    const themes: Theme[] = themeFilter
        ? [themeFilter as Theme]
        : manifest.themes;
    const blogRoot = path.join(workspaceRoot, 'apps/website/public/blog');
    const outputRoot = outputDirectoryFor({ blogRoot, group, release });

    // Belt and braces: the slug is validated above, but assert the resolved
    // path really lands inside the blog tree before anything deletes there.
    assertSync(
        path.resolve(outputRoot).startsWith(`${path.resolve(blogRoot)}${path.sep}`),
        `refusing to publish outside the blog tree: ${outputRoot}`
    );

    assertBuiltRuntime();

    // G1: snapshot the real database directory BEFORE anything launches.
    const dbBefore = snapshotDatabaseState(realDbDir);

    // Frames are staged outside the repo and published only once every shot
    // and every guard has passed, so a late failure can never destroy the
    // release assets an earlier run already committed.
    const stagingDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-shots-'));
    const mockServer = await driver.ensureXtreamMockServer(workspaceRoot);
    // The Stalker portal is seeded only for shots that walk into it: it adds
    // a third source card to the dashboard, which release shots must not show.
    const needsStalker = shots.some((shot: { setup: string[] }) =>
        shot.setup.some(
            (step) => parseSetupStep(String(step)).action === 'open-stalker-live'
        )
    );
    const stalkerMockServer = needsStalker
        ? await driver.ensureStalkerMockServer(workspaceRoot)
        : undefined;
    const dataDir = mkdtempSync(path.join(tmpdir(), 'iptvnator-release-shots-'));
    let app: Awaited<ReturnType<typeof driver.launchApp>> | undefined;
    let recordedRequests: string[] = [];
    let captured = 0;
    let primaryError: unknown;

    try {
        // G2: constructed environment — nothing ambient crosses over.
        app = await driver.launchApp(
            electronMainPath,
            buildCaptureEnv(process.env, {
                ELECTRON_IS_DEV: '0',
                IPTVNATOR_E2E_DATA_DIR: dataDir,
                NODE_ENV: 'test',
            }),
            HOST_RESOLVER_RULES
        );

        // G3, first layer: a main-process gate, installed before the renderer
        // can boot. It both records and blocks, because page-level routing
        // exists only once a page handle is obtained and never covers what the
        // main process itself fetches.
        await installRequestRecorder(app, networkPolicy());

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
        await driver.seedDemoData(page, driver.writeM3uFixture(dataDir), {
            stalker: needsStalker,
        });

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
        // passing run, which is how a guard silently stops guarding. Assert
        // it saw the renderer's own document load rather than merely "some"
        // traffic: seeding requests alone would prove nothing about whether
        // the hook existed before the renderer started fetching.
        assertSync(
            recordedRequests.some((url) => /\/index\.html?($|[?#])/.test(url)),
            `G3 failed: the request recorder never saw the renderer document load (${recordedRequests.length} URL(s) recorded) — it was installed too late to cover startup`
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
    } catch (error) {
        // Captured rather than rethrown: a failing run is exactly when a lost
        // isolation override is most likely, so G1 must still be evaluated.
        primaryError = error;
    } finally {
        // Close before the G1 comparison: SQLite runs in WAL mode, so writes
        // may sit in -wal until the worker shuts down and checkpoints.
        await app?.close().catch(() => undefined);
        mockServer?.kill('SIGTERM');
        stalkerMockServer?.kill('SIGTERM');
        rmSync(dataDir, { recursive: true, force: true });
    }

    const dbViolation = compareDatabaseStates(
        dbBefore,
        snapshotDatabaseState(realDbDir)
    );

    if (dbViolation) {
        rmSync(stagingDir, { recursive: true, force: true });
        throw new Error(
            `G1 failed: ${dbViolation}${
                primaryError instanceof Error
                    ? `\n(raised while handling: ${primaryError.message})`
                    : ''
            }`
        );
    }

    if (primaryError) {
        rmSync(stagingDir, { recursive: true, force: true });
        throw primaryError;
    }

    // A filtered run refreshes a subset, so it must overlay rather than
    // replace: publishing only the captured frames would delete every other
    // screenshot of the release.
    publishDirectory(stagingDir, outputRoot, String(process.pid), {
        mode: only || themeFilter ? 'merge' : 'replace',
    });
    rmSync(stagingDir, { recursive: true, force: true });
    console.log(
        `Captured ${captured} screenshot(s) into ${path.relative(workspaceRoot, outputRoot)}`
    );
    console.log(
        `Guards passed: ${new Set(recordedRequests).size} distinct request(s) observed, all local.`
    );
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
