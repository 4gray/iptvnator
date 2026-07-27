import type { Page } from '@playwright/test';
import type { StalkerSessionConnectionOutcome } from '@iptvnator/shared/interfaces';

import {
    closeElectronApp,
    expect,
    launchElectronApp,
    test,
} from './electron-test-fixtures';
import {
    StalkerReplayRun,
    withStalkerReplayRun,
} from './support/stalker-replay';

test.describe('Electron Stalker authenticated sessions', () => {
    test('@stalker @electron continues a status-2 authentication attempt with credentials', async ({
        dataDir,
    }) => {
        const replay = await withStalkerReplayRun(
            'authentication/status2-second-step',
            async (run) => {
                const app = await launchElectronApp(dataDir);

                try {
                    const { challenge, ready } = await openStatus2Session(
                        app.mainWindow,
                        run,
                        'e2e-status-2'
                    );

                    expect(challenge).toMatchObject({
                        attemptNumber: 1,
                        kind: 'credentials-required',
                    });
                    expect(ready).toMatchObject({
                        connectionMode: 'provisional',
                        kind: 'ready',
                        recipe: 'full-session',
                    });
                } finally {
                    await closeElectronApp(app);
                }
            }
        );

        expect(replay.finalization).toMatchObject({
            ledger: {
                mismatchCounts: {},
                operationCounts: {
                    'anonymous-probe': 1,
                    'do-auth': 1,
                    handshake: 1,
                    'profile-first': 1,
                    'profile-second': 1,
                },
                terminalState: 'complete',
            },
            ok: true,
        });
    });

    test('@stalker @electron keeps concurrent authenticated attempts isolated by replay run', async ({
        dataDir,
    }) => {
        const firstReplay = await withStalkerReplayRun(
            'authentication/status2-second-step',
            async (firstRun) =>
                withStalkerReplayRun(
                    'authentication/status2-second-step',
                    async (secondRun) => {
                        const app = await launchElectronApp(dataDir);

                        try {
                            return await Promise.all([
                                openStatus2Session(
                                    app.mainWindow,
                                    firstRun,
                                    'e2e-isolation-first'
                                ),
                                openStatus2Session(
                                    app.mainWindow,
                                    secondRun,
                                    'e2e-isolation-second'
                                ),
                            ]);
                        } finally {
                            await closeElectronApp(app);
                        }
                    }
                )
        );

        const secondReplay = firstReplay.result;
        const [firstSession, secondSession] = secondReplay.result;
        expect(firstSession.ready).toMatchObject({
            kind: 'ready',
            recipe: 'full-session',
        });
        expect(secondSession.ready).toMatchObject({
            kind: 'ready',
            recipe: 'full-session',
        });
        expect(firstReplay.finalization).toMatchObject({
            ledger: {
                mismatchCounts: {},
                terminalState: 'complete',
            },
            ok: true,
        });
        expect(secondReplay.finalization).toMatchObject({
            ledger: {
                mismatchCounts: {},
                terminalState: 'complete',
            },
            ok: true,
        });
    });
});

async function openStatus2Session(
    page: Page,
    run: StalkerReplayRun,
    playlistRef: string
): Promise<{
    challenge: StalkerSessionConnectionOutcome;
    ready: StalkerSessionConnectionOutcome;
}> {
    const challenge = await page.evaluate(
        async ({
            learnedEndpointHint,
            macAddress,
            playlistRef: rendererPlaylistRef,
            sourceUrl,
        }) => {
            const open = window.electron?.stalkerSessionOpen;
            if (!open) {
                throw new Error('stalker-session-open-unavailable');
            }

            return open({
                descriptor: {
                    connectionMode: 'provisional',
                    learnedEndpointHint,
                    macAddress,
                    playlistRef: rendererPlaylistRef,
                    profilePreset: {
                        id: 'mag250-public-5_1-minimal-v1',
                        version: 1,
                    },
                    provisionalReason: 'import',
                    sourceUrl,
                },
            });
        },
        {
            learnedEndpointHint: `${requiredOrigin(run, 'portal')}/portal.php`,
            macAddress: requiredInput(run, 'mac'),
            playlistRef,
            sourceUrl: run.entryUrl,
        }
    );
    if (challenge.kind !== 'credentials-required') {
        throw new Error('expected-credentials-challenge');
    }

    const ready = await page.evaluate(
        async ({ challengeRef, password, username }) => {
            const continueSession =
                window.electron?.stalkerSessionContinue;
            if (!continueSession) {
                throw new Error('stalker-session-continue-unavailable');
            }

            return continueSession({
                challengeRef,
                response: {
                    kind: 'credentials',
                    password,
                    username,
                },
            });
        },
        {
            challengeRef: challenge.challengeRef,
            password: requiredInput(run, 'password'),
            username: requiredInput(run, 'username'),
        }
    );

    return { challenge, ready };
}

function requiredInput(run: StalkerReplayRun, name: string): string {
    const value = run.inputs[name];
    if (!value) {
        throw new Error(`stalker-replay-input-missing:${name}`);
    }
    return value;
}

function requiredOrigin(run: StalkerReplayRun, name: string): string {
    const value = run.origins[name];
    if (!value) {
        throw new Error(`stalker-replay-origin-missing:${name}`);
    }
    return value;
}
