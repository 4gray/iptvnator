import { activitySyncFixture as fixture } from './test-stubs/activity-sync-fixture.stub';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';

describe('failed launches superseded before their first checkpoint', () => {
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });

    it.each(['reset', 'mark-watched', 'import', 'resolve', 'begin'] as const)(
        'does not restore stale local progress after a committed %s',
        async (action) => {
            const f = fixture();
            if (action === 'resolve') {
                f.setRemote({
                    kind: 'begin',
                    operationId: 'synthetic-remote-begin',
                    deviceId: 'synthetic-remote',
                    expectedRevision: 0,
                    sessionId: 'synthetic-remote-session',
                });
                f.setRemote({
                    kind: 'checkpoint',
                    operationId: 'synthetic-remote-point',
                    deviceId: 'synthetic-remote',
                    generation: 1,
                    sessionId: 'synthetic-remote-session',
                    sequence: 1,
                    resume: { positionSeconds: 30, durationSeconds: 100 },
                });
                await f.client.refresh(f.address.sourceId);
            }
            jest.spyOn(f.store, 'mutate').mockRejectedValueOnce(
                new Error('Synthetic failed launch')
            );
            const older = {
                ...f.position,
                activitySessionId: 'synthetic-no-checkpoint',
            };
            await expect(
                f.client.begin(f.address.sourceId, older)
            ).rejects.toThrow('Synthetic failed launch');
            expect(f.client.localSessions.has(older.activitySessionId)).toBe(
                true
            );
            if (action === 'reset')
                await f.client.reset(f.address.sourceId, f.position);
            else if (action === 'mark-watched')
                await f.client.save(f.address.sourceId, {
                    ...f.position,
                    activityAction: 'mark-watched',
                });
            else if (action === 'import')
                await f.client.importPosition(f.address.sourceId, {
                    ...f.position,
                    positionSeconds: 80,
                });
            else if (action === 'resolve')
                await f.client.resolve(f.address, false);
            else {
                const newer = {
                    ...f.position,
                    positionSeconds: 80,
                    activitySessionId: 'synthetic-new-session',
                };
                await f.client.begin(f.address.sourceId, newer);
                await f.client.save(f.address.sourceId, newer);
            }
            await f.client.flush();
            await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
                f.address.sourceId,
                { ...older, positionSeconds: 65 },
            ]);
            const projected = await f.adapter.all(f.raw, f.address.sourceId);
            if (action === 'reset') expect(projected).toEqual([]);
            else if (action === 'mark-watched')
                expect(projected[0].watched).toBe(true);
            else
                expect(projected[0].positionSeconds).toBe(
                    action === 'resolve' ? 30 : 80
                );
            expect(f.client.retiredSessions.has(older.activitySessionId)).toBe(
                true
            );
            expect(f.client.localSessions.has(older.activitySessionId)).toBe(
                false
            );
        }
    );

    it('leaves a failed launch for another item retryable', async () => {
        const f = fixture();
        const first = { ...f.position, activitySessionId: 'synthetic-first' };
        const other = {
            ...f.position,
            contentXtreamId: 43,
            activitySessionId: 'synthetic-other',
        };
        const fail = jest.spyOn(f.store, 'mutate');
        for (const position of [first, other]) {
            fail.mockRejectedValueOnce(new Error('Synthetic storage failure'));
            await expect(
                f.client.begin(f.address.sourceId, position)
            ).rejects.toThrow();
        }
        await f.client.reset(f.address.sourceId, first);
        expect(f.client.localSessions.has(other.activitySessionId)).toBe(true);
        await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...other, positionSeconds: 65 },
        ]);
        expect(
            (await f.adapter.all(f.raw, f.address.sourceId)).find(
                (p) => p.contentXtreamId === 43
            )?.positionSeconds
        ).toBe(65);
    });
});

describe('reacquiring failed playback ownership', () => {
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('keeps the session active when local conflict resolution reacquires it after a lost acknowledgement', async () => {
        const f = fixture();
        const mutate = f.store.mutate;
        jest.spyOn(f.store, 'mutate').mockImplementationOnce(
            async (address, update) => {
                await mutate(address, update);
                throw new Error('Synthetic lost acknowledgement');
            }
        );
        const position = {
            ...f.position,
            positionSeconds: 80,
            activitySessionId: 'synthetic-reacquired',
        };
        await expect(
            f.client.begin(f.address.sourceId, position)
        ).rejects.toThrow('Synthetic lost acknowledgement');
        await f.client.resolve(f.address, true);
        await f.client.flush();
        await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...position, positionSeconds: 85 },
        ]);
        await f.client.flush();
        expect(
            (await f.adapter.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(85);
        expect(f.client.localSessions.has(position.activitySessionId)).toBe(
            false
        );
        expect(f.client.retiredSessions.has(position.activitySessionId)).toBe(
            false
        );
    });
    it('ignores a recovering old player context response after a new source incarnation starts', async () => {
        const f = fixture();
        f.client.contexts.clear();
        let entered!: () => void;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        jest.spyOn(f.client.options, 'request').mockImplementationOnce(
            async () => {
                entered();
                await held;
                return {
                    status: 200,
                    body: {
                        sourceId: f.address.sourceId,
                        sourceIncarnation: 'synthetic-old-incarnation',
                        provider: 'xtream',
                    },
                };
            }
        );
        const recovering = f.adapter.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            {
                ...f.position,
                activitySessionId: 'synthetic-old-external',
                positionSeconds: 65,
            },
        ]);
        await started;
        const newer = {
            ...f.position,
            activitySessionId: 'synthetic-current',
            positionSeconds: 80,
        };
        await f.client.begin(f.address.sourceId, newer);
        await f.client.save(f.address.sourceId, newer);
        await f.client.flush();
        release();
        await recovering;
        expect(
            f.client.contexts.get(f.address.sourceId)?.sourceIncarnation
        ).toBe(f.address.sourceIncarnation);
        await f.adapter.invoke(f.raw, 'savePlaybackPosition', [
            f.address.sourceId,
            { ...newer, positionSeconds: 85 },
        ]);
        await f.client.flush();
        expect(
            (await f.adapter.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(85);
    });
});

describe('source context responses superseded by newer work', () => {
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('does not let a stale refresh replace the current playback incarnation', async () => {
        const f = fixture();
        f.client.contexts.clear();
        let entered!: () => void;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        jest.spyOn(f.client.options, 'request').mockImplementationOnce(
            async () => {
                entered();
                await held;
                return {
                    status: 200,
                    body: {
                        sourceId: f.address.sourceId,
                        sourceIncarnation: 'synthetic-obsolete-refresh',
                        provider: 'xtream',
                    },
                };
            }
        );
        const refresh = f.client.refresh(f.address.sourceId);
        await started;
        const current = {
            ...f.position,
            activitySessionId: 'synthetic-current-refresh',
            positionSeconds: 80,
        };
        await f.client.begin(f.address.sourceId, current);
        await f.client.save(f.address.sourceId, current);
        await f.client.flush();
        release();
        await refresh;
        expect(
            f.client.contexts.get(f.address.sourceId)?.sourceIncarnation
        ).toBe(f.address.sourceIncarnation);
        await f.client.save(f.address.sourceId, {
            ...current,
            positionSeconds: 85,
        });
        await f.client.flush();
        expect(
            (await f.adapter.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(85);
    });
});

describe('compatible concurrent source reads', () => {
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('allows playback to acquire ownership when a newer refresh accepts the same incarnation', async () => {
        const f = fixture();
        f.client.contexts.clear();
        let entered!: () => void;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        jest.spyOn(f.client.options, 'request').mockImplementationOnce(
            async () => {
                entered();
                await held;
                return {
                    status: 200,
                    body: {
                        sourceId: f.address.sourceId,
                        sourceIncarnation: f.address.sourceIncarnation,
                        provider: 'xtream',
                    },
                };
            }
        );
        const position = {
            ...f.position,
            activitySessionId: 'synthetic-compatible-reader',
            positionSeconds: 80,
        };
        const begin = f.client.begin(f.address.sourceId, position);
        await started;
        await f.client.refresh(f.address.sourceId);
        release();
        await begin;
        await f.client.save(f.address.sourceId, {
            ...position,
            positionSeconds: 85,
        });
        await f.client.flush();
        expect(f.client.retiredSessions.has(position.activitySessionId)).toBe(
            false
        );
        expect(
            (await f.adapter.all(f.raw, f.address.sourceId))[0].positionSeconds
        ).toBe(85);
    });
    it('does not recreate a forgotten source from its pending context response', async () => {
        const f = fixture();
        f.client.contexts.clear();
        let entered!: () => void;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const status = jest.spyOn(f.client.options, 'status');
        jest.spyOn(f.client.options, 'request').mockImplementationOnce(
            async () => {
                entered();
                await held;
                return {
                    status: 200,
                    body: {
                        sourceId: f.address.sourceId,
                        sourceIncarnation: f.address.sourceIncarnation,
                        provider: 'xtream',
                    },
                };
            }
        );
        const refresh = f.client.refresh(f.address.sourceId);
        await started;
        f.client.forgetContext(f.address.sourceId);
        release();
        await refresh;
        expect(f.client.contexts.has(f.address.sourceId)).toBe(false);
        expect(status).not.toHaveBeenCalledWith('offline');
    });
});

describe('failed portable episode identity', () => {
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    it('retires a matching episode across legacy tracking aliases while preserving another episode', () => {
        const f = fixture();
        const identity = {
            provider: 'stalker' as const,
            kind: 'episode' as const,
            id: 'synthetic-episode',
            seriesId: 'synthetic-series',
            mode: 'regular' as const,
            seasonKey: 'synthetic-season',
            episodeNumber: 2,
        };
        f.client.acceptContext({
            sourceId: f.address.sourceId,
            sourceIncarnation: f.address.sourceIncarnation,
            provider: 'stalker',
        });
        f.client.localSessions.set('synthetic-alias', {
            sourceId: f.address.sourceId,
            position: {
                contentType: 'episode',
                contentXtreamId: 501,
                activityIdentity: identity,
            },
        });
        f.client.localSessions.set('synthetic-sibling-episode', {
            sourceId: f.address.sourceId,
            position: {
                contentType: 'episode',
                contentXtreamId: 501,
                activityIdentity: {
                    ...identity,
                    id: 'synthetic-other-episode',
                    episodeNumber: 3,
                },
            },
        });
        f.client.committed(
            f.address.sourceId,
            {
                contentType: 'episode',
                contentXtreamId: 1001,
                activityIdentity: identity,
            },
            'command'
        );
        expect(f.client.retiredSessions.has('synthetic-alias')).toBe(true);
        expect(f.client.localSessions.has('synthetic-sibling-episode')).toBe(
            true
        );
        expect(f.client.retiredSessions.has('synthetic-sibling-episode')).toBe(
            false
        );
    });
});
