import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type {
    ActivityAddress,
    ActivityLocalRecord,
    ActivityLocalRequest,
} from '@iptvnator/shared/interfaces/activity-sync';
import { ActivitySyncClient } from './activity-sync-client';
import { ActivitySupersededError } from './activity-action-fence';
import { ElectronActivityLocalStore } from './electron-activity-local';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('checkpoint invocation order through Electron CAS retries', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });
    it.each([
        [20, 30, 1000],
        [30, 20, 1000],
        [80, 20, -1000],
    ])(
        'orders checkpoint captures (%s → %s with timestamp offset %s)',
        async (firstPosition, secondPosition, offset) => {
            let record: ActivityLocalRecord | null = null;
            let address!: ActivityAddress;
            let release!: () => void;
            let entered!: () => void;
            let blocked = false;
            let conflicts = 0;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const waiting = new Promise<void>((resolve) => {
                entered = resolve;
            });
            const send = async (
                request: ActivityLocalRequest
            ): Promise<unknown> => {
                if (request.operation === 'read') return clone(record);
                if (request.operation === 'pending')
                    return clone(record?.pending ?? []);
                if (request.operation === 'list')
                    return record ? [{ address, record: clone(record) }] : [];
                address = request.address;
                const last =
                    request.value.pending[request.value.pending.length - 1]
                        ?.operation;
                if (
                    !blocked &&
                    last?.kind === 'checkpoint' &&
                    last.resume.positionSeconds === firstPosition
                ) {
                    blocked = true;
                    entered();
                    await held;
                }
                if (
                    request.expected !==
                    (record === null ? null : JSON.stringify(record))
                ) {
                    conflicts++;
                    return { conflict: true };
                }
                record = clone(request.value);
                return { value: clone(record) };
            };
            const store = new ElectronActivityLocalStore('synthetic-nas', send);
            const client = new ActivitySyncClient(store, {
                instanceId: 'synthetic-nas',
                deviceId: 'synthetic-device',
                contexts: [
                    {
                        sourceId: 'synthetic-source',
                        sourceIncarnation: 'synthetic-incarnation',
                        provider: 'xtream',
                    },
                ],
                consent: () => 'synthetic-consent',
                changed: () => undefined,
                status: () => undefined,
                request: async () => {
                    throw new Error('Synthetic offline transport');
                },
            });
            const position: PlaybackPositionData = {
                contentType: 'vod',
                contentXtreamId: 42,
                activitySessionId: 'synthetic-session',
                positionSeconds: 0,
                durationSeconds: 100,
            };
            await client.begin('synthetic-source', position);
            await client.flush();
            const webCheckpointAt = new Date().toISOString();
            const nativeCheckpointAt = new Date(
                Date.now() + offset
            ).toISOString();
            const delayed = client.save('synthetic-source', {
                ...position,
                positionSeconds: firstPosition,
            });
            await waiting;
            const nativePosition = {
                ...position,
                positionSeconds: secondPosition,
                nativeCheckpointAt,
            };
            const nativeSave = client.save('synthetic-source', nativePosition);
            if (offset < 0) {
                await expect(nativeSave).rejects.toBeInstanceOf(
                    ActivitySupersededError
                );
            } else {
                await nativeSave;
            }
            await client.flush();
            release();
            await delayed;
            await client.flush();
            if (offset < 0) {
                await client.save('synthetic-source', nativePosition);
                expect(conflicts).toBe(0);
            } else {
                expect(conflicts).toBeGreaterThan(0);
            }
            const expectedPosition =
                offset < 0 ? firstPosition : secondPosition;
            expect(
                (await client.positions('synthetic-source'))[0].position
                    .updatedAt
            ).toBe(offset < 0 ? webCheckpointAt : nativeCheckpointAt);
            expect(
                (await store.read(address))?.state.resume?.positionSeconds
            ).toBe(expectedPosition);
            expect(
                (await store.pending())
                    .filter((intent) => intent.operation.kind === 'checkpoint')
                    .map((intent) =>
                        intent.operation.kind === 'checkpoint'
                            ? intent.operation.resume.positionSeconds
                            : undefined
                    )
            ).toEqual([expectedPosition]);
        }
    );
});
