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

test.describe('Electron Stalker endpoint discovery', () => {
    test('@stalker @electron discovers a full session from a custom-prefix source without a learned endpoint', async ({
        dataDir,
    }) => {
        const replay = await withStalkerReplayRun(
            'resolver/custom-prefix-full',
            async (run) => {
                const app = await launchElectronApp(dataDir);

                try {
                    const ready = await app.mainWindow.evaluate(
                        async ({ macAddress, sourceUrl }) => {
                            const open = window.electron?.stalkerSessionOpen;
                            if (!open) {
                                throw new Error(
                                    'stalker-session-open-unavailable'
                                );
                            }
                            return open({
                                descriptor: {
                                    connectionMode: 'provisional',
                                    macAddress,
                                    playlistRef: 'e2e-custom-prefix-discovery',
                                    profilePreset: {
                                        id: 'mag250-public-5_1-minimal-v1',
                                        version: 1,
                                    },
                                    provisionalReason: 'migration',
                                    sourceUrl,
                                },
                            });
                        },
                        {
                            macAddress: requiredInput(run, 'mac'),
                            sourceUrl: run.entryUrl,
                        }
                    );

                    expect(ready.kind, JSON.stringify(ready)).toBe('ready');
                    expect(ready).toMatchObject({
                        connectionMode: 'provisional',
                        endpoint: `${requiredOrigin(
                            run,
                            'portal'
                        )}/tenant/server/load.php`,
                        kind: 'ready',
                        recipe: 'full-session',
                    });
                    if (
                        ready.kind !== 'ready' ||
                        ready.connectionMode !== 'provisional'
                    ) {
                        throw new Error(
                            `expected-provisional-ready:${JSON.stringify(ready)}`
                        );
                    }

                    const committed = await app.mainWindow.evaluate(
                        async (attemptRef) => {
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
                        ready.attemptRef
                    );
                    expect(committed).toMatchObject({
                        action: 'commit',
                        kind: 'success',
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
                    'custom-handshake': 1,
                    'custom-landing': 1,
                    'custom-profile': 1,
                },
                terminalState: 'complete',
            },
            ok: true,
        });
    });
});

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
