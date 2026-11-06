import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    closeElectronAppAndConfirmExit,
    launchElectronApp,
    workspaceRoot,
} from '../electron-test-fixtures';
import { JOURNEY_IPC_SENTINEL_ID } from '../performance/journey-renderer-probe';
import {
    installJourneySentinelSqlSampler,
    readJourneySentinelSql,
} from '../performance/journey-sentinel-sql';
import {
    ensureLargeLibraryProfile,
    type LargeLibraryProfile,
} from '../performance/large-library-profile-cache';
import {
    createLaunchLargeJourneyPhases,
    LAUNCH_LARGE_RAILS_SENTINEL_ID,
    LAUNCH_LARGE_SQL_SAMPLE,
    type LaunchLargeJourneyMeasurement,
} from '../performance/launch-large-journey-record';
import { journeyLaunchOptions, runLaunchJourney } from './launch-journey-app';

/**
 * Process lifecycle for `launch-large`: the generated profile (cached by
 * content hash) is copied once and launched once through the real app, so
 * the template carries what a first session writes (migration receipts,
 * the renderer's own storage); every iteration then copies that template and
 * spawns a fresh process on it, as J1 does.
 */
export const LAUNCH_LARGE_JOURNEY_ENV = 'IPTVNATOR_JOURNEY_LARGE_LIBRARY';
/** A pre-fix profile reached its rails after 97 s cold on the real database. */
export const LAUNCH_LARGE_ITERATION_TIMEOUT_MS = 300_000;
const SENTINEL_SQL_STATE_KEY = '__iptvnatorJourneyLaunchLargeSentinelSql';
const FIRST_CARD_SELECTOR =
    '[data-test-id="dashboard-recent-sources-rail-card"]';
const RAILS_SELECTOR = '[data-test-id="dashboard-continue-watching-rail-card"]';

export function isLaunchLargeJourneyEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
    return env[LAUNCH_LARGE_JOURNEY_ENV] === '1';
}

export interface LaunchLargeSeed {
    readonly profile: LargeLibraryProfile;
    /** The first app session on the profile, in milliseconds from spawn. */
    readonly seedLaunch: {
        readonly spawnToFirstCardMs: number;
        readonly spawnToRailsMs: number;
    };
    readonly templateDirectory: string;
}

function removeDirectory(directory: string): Promise<void> {
    return rm(directory, {
        force: true,
        maxRetries: 20,
        recursive: true,
        retryDelay: 250,
    });
}

/**
 * Finds or generates the profile, copies it and runs the app on the copy
 * once until the dashboard's rails are up. The generated directory itself
 * is never launched on: the app writes to the profile it opens.
 */
export async function seedLaunchLargeTemplate(): Promise<LaunchLargeSeed> {
    const profile = await ensureLargeLibraryProfile(workspaceRoot);
    const templateDirectory = await mkdtemp(
        join(tmpdir(), 'iptvnator-journey-launch-large-seed-')
    );
    try {
        await cp(profile.directory, templateDirectory, { recursive: true });
        const spawnEpochMs = Date.now();
        const app = await launchElectronApp(
            templateDirectory,
            journeyLaunchOptions()
        );
        let spawnToFirstCardMs = 0;
        let spawnToRailsMs = 0;
        try {
            await app.mainWindow.locator(FIRST_CARD_SELECTOR).first().waitFor({
                state: 'visible',
                timeout: LAUNCH_LARGE_ITERATION_TIMEOUT_MS,
            });
            spawnToFirstCardMs = Date.now() - spawnEpochMs;
            await app.mainWindow.locator(RAILS_SELECTOR).first().waitFor({
                state: 'visible',
                timeout: LAUNCH_LARGE_ITERATION_TIMEOUT_MS,
            });
            spawnToRailsMs = Date.now() - spawnEpochMs;
        } finally {
            await closeElectronAppAndConfirmExit(app);
        }
        return {
            profile,
            seedLaunch: { spawnToFirstCardMs, spawnToRailsMs },
            templateDirectory,
        };
    } catch (failure) {
        await removeDirectory(templateDirectory);
        throw failure;
    }
}

export function removeLaunchLargeTemplate(directory: string): Promise<void> {
    return removeDirectory(directory);
}

/**
 * One measured launch: J1's instrumentation with the rails phase instead of
 * the idle window, plus the SQL totals sampled when the first-card and the
 * rails sentinels arrive in the main process.
 */
export async function measureLaunchLargeJourney(
    templateDirectory: string
): Promise<LaunchLargeJourneyMeasurement> {
    const { continuation, launch } = await runLaunchJourney(
        templateDirectory,
        LAUNCH_LARGE_ITERATION_TIMEOUT_MS,
        {
            idleWindowMs: null,
            instrument: (electronApp) =>
                installJourneySentinelSqlSampler(electronApp, {
                    markers: {
                        [LAUNCH_LARGE_SQL_SAMPLE.FIRST_CARD]:
                            JOURNEY_IPC_SENTINEL_ID,
                        [LAUNCH_LARGE_SQL_SAMPLE.RAILS_SETTLED]:
                            LAUNCH_LARGE_RAILS_SENTINEL_ID,
                    },
                    sentinelMethod: 'cancelSourceProbe',
                    stateKey: SENTINEL_SQL_STATE_KEY,
                }),
            mainCounters: true,
            phases: createLaunchLargeJourneyPhases(),
        },
        ({ electronApp }) =>
            readJourneySentinelSql(electronApp, SENTINEL_SQL_STATE_KEY, 10_000)
    );
    return { ...launch, sqlAtSentinels: continuation };
}
