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

test.describe('Electron Stalker authenticated session refresh', () => {
    test('@stalker @electron refreshes concurrent rejected catalog requests once', async ({
        dataDir,
    }) => {
        const replay = await withStalkerReplayRun(
            'e2e/concurrent-catalog-refresh',
            async (run) => {
                const app = await launchElectronApp(dataDir);

                try {
                    const ready = await openProvisionalSession(
                        app.mainWindow,
                        run,
                        'e2e-concurrent-refresh'
                    );
                    if (
                        ready.kind !== 'ready' ||
                        ready.recipe !== 'full-session' ||
                        ready.connectionMode !== 'provisional'
                    ) {
                        throw new Error(
                            `expected-full-session:${JSON.stringify(ready)}`
                        );
                    }
                    const committed = await app.mainWindow.evaluate(
                        async ({ attemptRef }) => {
                            const control =
                                window.electron?.stalkerSessionControl;
                            if (!control) {
                                throw new Error(
                                    'stalker-session-control-unavailable'
                                );
                            }

                            return control({
                                action: 'commit',
                                attemptRef,
                            });
                        },
                        { attemptRef: ready.attemptRef }
                    );
                    expect(committed).toMatchObject({
                        action: 'commit',
                        kind: 'success',
                    });

                    const outcomes = await app.mainWindow.evaluate(
                        async ({ leaseRef }) => {
                            const request =
                                window.electron?.stalkerSessionRequest;
                            if (!request) {
                                throw new Error(
                                    'stalker-session-request-unavailable'
                                );
                            }

                            return Promise.all([
                                request({
                                    leaseRef,
                                    operation: 'get-ordered-list',
                                    parameters: {
                                        category: 'news',
                                        contentType: 'itv',
                                        page: 1,
                                    },
                                }),
                                request({
                                    leaseRef,
                                    operation: 'get-ordered-list',
                                    parameters: {
                                        category: 'sports',
                                        contentType: 'itv',
                                        page: 2,
                                    },
                                }),
                            ]);
                        },
                        { leaseRef: ready.leaseRef }
                    );

                    expect(outcomes).toMatchObject([
                        {
                            kind: 'success',
                            operation: 'get-ordered-list',
                            payload: {
                                items: [{ id: 'news-channel' }],
                                page: 1,
                            },
                        },
                        {
                            kind: 'success',
                            operation: 'get-ordered-list',
                            payload: {
                                items: [{ id: 'sports-channel' }],
                                page: 2,
                            },
                        },
                    ]);
                    expect(
                        JSON.stringify({ committed, outcomes, ready })
                    ).not.toMatch(/authorization|bearer|cookie|token/i);
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
                    'initial-handshake': 1,
                    'initial-profile': 1,
                    'refresh-anonymous-probe': 1,
                    'refresh-handshake': 1,
                    'refresh-profile': 1,
                    'reject-news': 1,
                    'reject-sports': 1,
                    'retry-news': 1,
                    'retry-sports': 1,
                },
                terminalState: 'complete',
            },
            ok: true,
        });
    });
});

async function openProvisionalSession(
    page: Page,
    run: StalkerReplayRun,
    playlistRef: string
): Promise<StalkerSessionConnectionOutcome> {
    return page.evaluate(
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
