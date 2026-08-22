// Marks the file as a module. Without it the top-level bindings below land in
// the global scope and collide with same-named consts in sibling event specs
// (stream-probe.spec.ts declares its own `registeredHandlers`). The spec
// otherwise has no static imports on purpose: every dependency is swapped
// through `jest.doMock` before the dynamic import in the harness.
export {};

type IpcHandler = (_event: unknown, ...args: unknown[]) => Promise<unknown>;

const registeredHandlers = new Map<string, IpcHandler>();
const mockGetDatabase = jest.fn();
const mockBroadcast = jest.fn();
const mockStopRecording = jest.fn();
const mockWhenSettled = jest.fn();
const mockIsAvailableDownloadFile = jest.fn();
const mockGetAvailabilityAsync = jest.fn();
const mockUnlink = jest.fn();
const mockStat = jest.fn();
const mockOpenPath = jest.fn();
const mockShowItemInFolder = jest.fn();

function getHandler(channel: string): IpcHandler {
    const handler = registeredHandlers.get(channel);
    if (!handler) {
        throw new Error(`Expected IPC handler for ${channel}`);
    }
    return handler;
}

async function setupRecordingsEventsHarness(): Promise<void> {
    jest.resetModules();
    registeredHandlers.clear();
    mockGetDatabase.mockReset();
    mockBroadcast.mockReset();
    mockStopRecording.mockReset();
    mockWhenSettled.mockReset().mockResolvedValue(undefined);
    mockIsAvailableDownloadFile.mockReset().mockReturnValue(true);
    mockGetAvailabilityAsync.mockReset().mockResolvedValue('available');
    mockUnlink.mockReset().mockResolvedValue(undefined);
    mockStat.mockReset().mockResolvedValue({ isFile: () => true, size: 4096 });
    mockOpenPath.mockReset().mockResolvedValue('');
    mockShowItemInFolder.mockReset();

    jest.doMock('electron', () => ({
        ipcMain: {
            handle: jest.fn((channel: string, handler: IpcHandler) => {
                registeredHandlers.set(channel, handler);
            }),
        },
        shell: {
            openPath: mockOpenPath,
            showItemInFolder: mockShowItemInFolder,
        },
    }));
    jest.doMock('node:fs/promises', () => ({
        ...jest.requireActual<typeof import('node:fs/promises')>(
            'node:fs/promises'
        ),
        stat: mockStat,
        unlink: mockUnlink,
    }));
    jest.doMock('../../database/connection', () => ({
        getDatabase: mockGetDatabase,
    }));
    jest.doMock('../../services/embedded-mpv-native.service', () => ({
        embeddedMpvNativeService: { stopRecording: mockStopRecording },
    }));
    jest.doMock('../../services/embedded-mpv-recording-tracker', () => ({
        embeddedMpvRecordingTracker: { whenSettled: mockWhenSettled },
    }));
    jest.doMock('./recording-broadcast', () => ({
        broadcastRecordingsUpdate: mockBroadcast,
    }));
    jest.doMock('./download-file-availability', () => ({
        getDownloadFileAvailabilityWithTimeoutAsync: mockGetAvailabilityAsync,
        isAvailableDownloadFile: mockIsAvailableDownloadFile,
    }));

    await import('./recordings.events');
}

function recordingRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 42,
        sessionId: 'session-1',
        ownerPid: null,
        status: 'completed',
        filePath: '/rec/News-20260815-210000.ts',
        fileSizeBytes: 1024,
        channelName: 'Channel One',
        channelLogoUrl: null,
        playlistId: 'playlist-a',
        playlistName: 'My provider',
        sourceType: 'm3u',
        epgChannelId: null,
        programTitle: 'Evening News',
        programDescription: null,
        programStart: '2026-08-15T21:00:00Z',
        programStop: '2026-08-15T21:45:00Z',
        programsJson: null,
        errorMessage: null,
        startedAt: '2026-08-15T21:00:00Z',
        endedAt: '2026-08-15T21:58:00Z',
        createdAt: null,
        updatedAt: null,
        ...overrides,
    };
}

function mockListDb(rows: unknown[]) {
    const orderBy = jest.fn().mockResolvedValue(rows);
    const db = {
        select: jest.fn(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({ orderBy })),
                orderBy,
            })),
        })),
    };
    mockGetDatabase.mockResolvedValue(db);
    return { db, orderBy };
}

function mockRowDb(row: unknown | undefined) {
    const deleteWhere = jest.fn().mockResolvedValue(undefined);
    const updateWhere = jest.fn().mockResolvedValue(undefined);
    const updateSet = jest.fn((_patch: Record<string, string>) => ({
        where: updateWhere,
    }));
    const limit = jest.fn().mockResolvedValue(row ? [row] : []);
    const db = {
        delete: jest.fn(() => ({ where: deleteWhere })),
        update: jest.fn(() => ({ set: updateSet })),
        select: jest.fn(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({
                    limit,
                    orderBy: jest.fn(() => ({ limit })),
                })),
            })),
        })),
    };
    mockGetDatabase.mockResolvedValue(db);
    return { db, deleteWhere, updateSet, updateWhere };
}

describe('recordings events', () => {
    beforeEach(async () => {
        await setupRecordingsEventsHarness();
    });

    describe('RECORDINGS_GET_LIST', () => {
        it('decorates rows with availability and decoded programs', async () => {
            mockListDb([
                recordingRow({
                    programsJson: JSON.stringify([
                        {
                            title: 'Evening News',
                            start: '2026-08-15T21:00:00Z',
                            stop: '2026-08-15T21:45:00Z',
                        },
                        {
                            title: 'Weather',
                            start: '2026-08-15T21:45:00Z',
                            stop: '2026-08-15T22:10:00Z',
                        },
                    ]),
                }),
            ]);

            const result = (await getHandler('RECORDINGS_GET_LIST')(
                null
            )) as Array<Record<string, unknown>>;

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(
                expect.objectContaining({
                    id: 42,
                    fileAvailability: 'available',
                    channelName: 'Channel One',
                })
            );
            expect(result[0].programs).toHaveLength(2);
            // Availability probe sees interrupted/completed as completed.
            expect(mockGetAvailabilityAsync).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed' })
            );
        });

        it('reports the live size of an active recording from disk', async () => {
            // The tracker only persists file_size_bytes at finalization, so
            // the manager's growing size has to come from a stat here.
            mockListDb([
                recordingRow({
                    status: 'recording',
                    fileSizeBytes: null,
                    endedAt: null,
                }),
            ]);

            const result = (await getHandler('RECORDINGS_GET_LIST')(
                null
            )) as Array<Record<string, unknown>>;

            expect(mockStat).toHaveBeenCalledWith(
                '/rec/News-20260815-210000.ts'
            );
            expect(result[0].fileSizeBytes).toBe(4096);
        });

        it('keeps the persisted size for terminal rows without statting', async () => {
            mockListDb([recordingRow()]);

            const result = (await getHandler('RECORDINGS_GET_LIST')(
                null
            )) as Array<Record<string, unknown>>;

            expect(mockStat).not.toHaveBeenCalled();
            expect(result[0].fileSizeBytes).toBe(1024);
        });

        it('omits the live size when the active file cannot be statted', async () => {
            mockStat.mockRejectedValue(new Error('gone'));
            mockListDb([
                recordingRow({ status: 'recording', fileSizeBytes: null }),
            ]);

            const result = (await getHandler('RECORDINGS_GET_LIST')(
                null
            )) as Array<Record<string, unknown>>;

            expect(result[0].fileSizeBytes).toBeUndefined();
        });

        it('passes an inconclusive availability probe through as unknown', async () => {
            // Timeout/permission errors are not proof of absence; collapsing
            // them to 'missing' would move a good recording on a slow mount
            // to Needs attention and hide its file actions.
            mockGetAvailabilityAsync.mockResolvedValue('unknown');
            mockListDb([recordingRow()]);

            const result = (await getHandler('RECORDINGS_GET_LIST')(
                null
            )) as Array<Record<string, unknown>>;

            expect(result[0].fileAvailability).toBe('unknown');
        });

        it('bounds a hanging live-size stat so the list still resolves', async () => {
            // A recording directory on a dead network filesystem can leave
            // the stat pending forever; the list awaits every decorator, so
            // the probe must time out to "no size" instead of wedging it.
            mockStat.mockReturnValue(new Promise(() => undefined));
            mockListDb([
                recordingRow({
                    status: 'recording',
                    fileSizeBytes: null,
                    endedAt: null,
                }),
            ]);

            jest.useFakeTimers();
            try {
                const pending = getHandler('RECORDINGS_GET_LIST')(null);
                await jest.advanceTimersByTimeAsync(1_100);
                const result = (await pending) as Array<
                    Record<string, unknown>
                >;
                expect(result[0].fileSizeBytes).toBeUndefined();
            } finally {
                jest.useRealTimers();
            }
        });

        it('probes interrupted rows like completed ones but not failed rows', async () => {
            mockListDb([
                recordingRow({ status: 'interrupted' }),
                recordingRow({ id: 43, status: 'failed' }),
            ]);
            await getHandler('RECORDINGS_GET_LIST')(null);
            expect(mockGetAvailabilityAsync.mock.calls[0][0].status).toBe(
                'completed'
            );
            expect(mockGetAvailabilityAsync.mock.calls[1][0].status).toBe(
                'failed'
            );
        });
    });

    describe('RECORDINGS_STOP', () => {
        it('stops through the embedded MPV service for an active row', async () => {
            mockRowDb(
                recordingRow({ status: 'recording', endedAt: null })
            );
            await expect(
                getHandler('RECORDINGS_STOP')(null, 42)
            ).resolves.toEqual({ success: true });
            expect(mockStopRecording).toHaveBeenCalledWith('session-1');
        });

        it('refuses rows that are not active or lack a session id', async () => {
            mockRowDb(recordingRow());
            await expect(
                getHandler('RECORDINGS_STOP')(null, 42)
            ).resolves.toEqual({
                error: 'Recording is not active',
                success: false,
            });

            mockRowDb(
                recordingRow({ status: 'recording', sessionId: null })
            );
            await expect(
                getHandler('RECORDINGS_STOP')(null, 42)
            ).resolves.toMatchObject({ success: false });
            expect(mockStopRecording).not.toHaveBeenCalled();
        });

        it('refuses to stop a recording owned by another instance', async () => {
            // Session ids restart per process, so dispatching a foreign row's
            // id would stop an unrelated local recording.
            mockRowDb(
                recordingRow({
                    status: 'recording',
                    endedAt: null,
                    ownerPid: process.pid + 1,
                })
            );
            await expect(
                getHandler('RECORDINGS_STOP')(null, 42)
            ).resolves.toMatchObject({ success: false });
            expect(mockStopRecording).not.toHaveBeenCalled();
        });

        it('stops a row this process owns', async () => {
            mockRowDb(
                recordingRow({
                    status: 'recording',
                    endedAt: null,
                    ownerPid: process.pid,
                })
            );
            await expect(
                getHandler('RECORDINGS_STOP')(null, 42)
            ).resolves.toEqual({ success: true });
            expect(mockStopRecording).toHaveBeenCalledWith('session-1');
        });

        it('normalizes a native stop failure into an error result', async () => {
            mockRowDb(recordingRow({ status: 'recording' }));
            mockStopRecording.mockImplementation(() => {
                throw new Error('addon unavailable');
            });
            const consoleSpy = jest
                .spyOn(console, 'error')
                .mockImplementation(() => undefined);
            await expect(
                getHandler('RECORDINGS_STOP')(null, 42)
            ).resolves.toEqual({ error: 'addon unavailable', success: false });
            consoleSpy.mockRestore();
        });
    });

    describe('RECORDINGS_REMOVE', () => {
        it('removes a finished row, keeps its file, and broadcasts', async () => {
            const { deleteWhere } = mockRowDb(recordingRow());
            await expect(
                getHandler('RECORDINGS_REMOVE')(null, 42)
            ).resolves.toEqual({ success: true });
            expect(mockUnlink).not.toHaveBeenCalled();
            expect(deleteWhere).toHaveBeenCalledTimes(1);
            expect(mockBroadcast).toHaveBeenCalledTimes(1);
        });

        it('cleans up the leftover file for failed rows, best-effort', async () => {
            mockRowDb(recordingRow({ status: 'failed' }));
            mockUnlink.mockRejectedValue(new Error('already gone'));
            await expect(
                getHandler('RECORDINGS_REMOVE')(null, 42)
            ).resolves.toEqual({ success: true });
            expect(mockUnlink).toHaveBeenCalledWith(
                '/rec/News-20260815-210000.ts'
            );
        });

        it('keeps the file when another row already owns that path', async () => {
            // A retry inside the same timestamp second reuses the freed name;
            // unlinking here would take the newer recording's file.
            const deleteWhere = jest.fn().mockResolvedValue(undefined);
            const limit = jest
                .fn()
                .mockResolvedValueOnce([recordingRow({ status: 'failed' })])
                .mockResolvedValueOnce([{ id: 42 }, { id: 77 }]);
            mockGetDatabase.mockResolvedValue({
                delete: jest.fn(() => ({ where: deleteWhere })),
                select: jest.fn(() => ({
                    from: jest.fn(() => ({
                        where: jest.fn(() => ({ limit })),
                    })),
                })),
            });

            await expect(
                getHandler('RECORDINGS_REMOVE')(null, 42)
            ).resolves.toEqual({ success: true });

            expect(mockUnlink).not.toHaveBeenCalled();
            expect(deleteWhere).toHaveBeenCalledTimes(1);
        });

        it('refuses to remove an active recording', async () => {
            const { deleteWhere } = mockRowDb(
                recordingRow({ status: 'recording' })
            );
            await expect(
                getHandler('RECORDINGS_REMOVE')(null, 42)
            ).resolves.toMatchObject({ success: false });
            expect(deleteWhere).not.toHaveBeenCalled();
        });

        it('reports a missing row', async () => {
            mockRowDb(undefined);
            await expect(
                getHandler('RECORDINGS_REMOVE')(null, 42)
            ).resolves.toEqual({
                error: 'Recording not found',
                success: false,
            });
        });
    });

    describe('RECORDINGS_UPDATE_PROGRAMS', () => {
        const programs = [
            {
                title: 'Evening News',
                start: '2026-08-15T21:00:00Z',
                stop: '2026-08-15T21:45:00Z',
            },
        ];

        it('rejects invalid payloads without touching the database', async () => {
            await expect(
                getHandler('RECORDINGS_UPDATE_PROGRAMS')(null, '', programs)
            ).resolves.toMatchObject({ success: false });
            await expect(
                getHandler('RECORDINGS_UPDATE_PROGRAMS')(
                    null,
                    '/rec/a.ts',
                    'not-an-array'
                )
            ).resolves.toMatchObject({ success: false });
            expect(mockGetDatabase).not.toHaveBeenCalled();
        });

        it('waits for the queued row INSERT before looking the row up', async () => {
            // A recording stopped milliseconds after starting: the row may
            // still be queued, and an unsynchronized lookup would find
            // nothing.
            let releaseTracker: (() => void) | undefined;
            mockWhenSettled.mockReturnValue(
                new Promise<void>((resolve) => {
                    releaseTracker = resolve;
                })
            );
            const { updateSet } = mockRowDb(recordingRow());

            const pending = getHandler('RECORDINGS_UPDATE_PROGRAMS')(
                null,
                '/rec/News-20260815-210000.ts',
                programs
            );
            await Promise.resolve();
            expect(mockGetDatabase).not.toHaveBeenCalled();

            releaseTracker?.();
            await expect(pending).resolves.toEqual({ success: true });
            expect(updateSet).toHaveBeenCalledTimes(1);
        });

        it('writes programs and keeps an existing headline program', async () => {
            const { updateSet } = mockRowDb(recordingRow());
            await expect(
                getHandler('RECORDINGS_UPDATE_PROGRAMS')(
                    null,
                    '/rec/News-20260815-210000.ts',
                    programs
                )
            ).resolves.toEqual({ success: true });
            const patch = updateSet.mock.calls[0][0];
            expect(JSON.parse(patch.programsJson)).toHaveLength(1);
            expect(patch).not.toHaveProperty('programTitle');
            expect(mockBroadcast).toHaveBeenCalledTimes(1);
        });

        it('backfills the headline program when the start snapshot had none', async () => {
            const { updateSet } = mockRowDb(
                recordingRow({ programTitle: null })
            );
            await getHandler('RECORDINGS_UPDATE_PROGRAMS')(
                null,
                '/rec/News-20260815-210000.ts',
                programs
            );
            expect(updateSet.mock.calls[0][0]).toEqual(
                expect.objectContaining({
                    programTitle: 'Evening News',
                    programStart: '2026-08-15T21:00:00Z',
                    programStop: '2026-08-15T21:45:00Z',
                })
            );
        });

        it('enriches a row that has not finalized yet', async () => {
            // Enrichment and finalization are order-independent: finalize()
            // writes status/time/size and never touches programs_json.
            const { updateSet } = mockRowDb(
                recordingRow({
                    status: 'recording',
                    endedAt: null,
                    programTitle: null,
                })
            );

            await expect(
                getHandler('RECORDINGS_UPDATE_PROGRAMS')(
                    null,
                    '/rec/News-20260815-210000.ts',
                    programs
                )
            ).resolves.toEqual({ success: true });
            expect(JSON.parse(updateSet.mock.calls[0][0].programsJson)).toEqual(
                programs
            );
        });

        it('reports when no row matches the path', async () => {
            mockRowDb(undefined);
            await expect(
                getHandler('RECORDINGS_UPDATE_PROGRAMS')(
                    null,
                    '/rec/unknown.ts',
                    programs
                )
            ).resolves.toEqual({
                error: 'Recording not found',
                success: false,
            });
        });
    });

    describe('file actions', () => {
        it('gates reveal on the recordings table and availability', async () => {
            mockRowDb(undefined);
            await expect(
                getHandler('RECORDINGS_REVEAL_FILE')(null, '/rec/foreign.ts')
            ).resolves.toEqual({ error: 'File not found', success: false });
            expect(mockShowItemInFolder).not.toHaveBeenCalled();

            mockRowDb(recordingRow());
            await expect(
                getHandler('RECORDINGS_REVEAL_FILE')(
                    null,
                    '/rec/News-20260815-210000.ts'
                )
            ).resolves.toEqual({ success: true });
            expect(mockShowItemInFolder).toHaveBeenCalledWith(
                '/rec/News-20260815-210000.ts'
            );
        });

        it('refuses managed paths whose file is gone', async () => {
            mockRowDb(recordingRow());
            mockIsAvailableDownloadFile.mockReturnValue(false);
            await expect(
                getHandler('RECORDINGS_PLAY_FILE')(
                    null,
                    '/rec/News-20260815-210000.ts'
                )
            ).resolves.toEqual({ error: 'File not found', success: false });
            expect(mockOpenPath).not.toHaveBeenCalled();
        });

        it('plays a managed available file', async () => {
            mockRowDb(recordingRow());
            await expect(
                getHandler('RECORDINGS_PLAY_FILE')(
                    null,
                    '/rec/News-20260815-210000.ts'
                )
            ).resolves.toEqual({ success: true });
            expect(mockOpenPath).toHaveBeenCalledWith(
                '/rec/News-20260815-210000.ts'
            );
        });
    });
});
