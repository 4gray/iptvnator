import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { ActivitySyncClient } from '@iptvnator/services/activity-sync';
import {
    activityAddressKey,
    type ActivityAddress,
    type ActivityLocalRecord,
    type ActivityLocalStore,
} from '@iptvnator/shared/interfaces/activity-sync';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import { ActivityLocalOnlyPositions } from './activity-local-only-positions';
import { ActivityPositionAdapter } from './activity-position-adapter';

const KIDS: PersonalScope = 'profile:11111111-1111-4111-8111-111111111111';
class MemoryActivityStore implements ActivityLocalStore {
    private rows = new Map<
        string,
        { address: ActivityAddress; record: ActivityLocalRecord }
    >();
    async read(a: ActivityAddress) {
        return this.rows.get(activityAddressKey(a))?.record ?? null;
    }
    async entries(sourceId: string) {
        return [...this.rows.values()].filter(
            (row) => row.address.sourceId === sourceId
        );
    }
    async pending() {
        return [...this.rows.values()].flatMap((row) => row.record.pending);
    }
    async mutate(
        a: ActivityAddress,
        change: (c: ActivityLocalRecord | null) => ActivityLocalRecord
    ) {
        const record = change(
            this.rows.get(activityAddressKey(a))?.record ?? null
        );
        this.rows.set(activityAddressKey(a), { address: a, record });
        return record;
    }
}
const household: PlaybackPositionData = {
    contentType: 'vod',
    contentXtreamId: 7,
    positionSeconds: 30,
    durationSeconds: 100,
    playlistId: 'src',
};
const kidsMovie: PlaybackPositionData = {
    contentType: 'vod',
    contentXtreamId: 42,
    positionSeconds: 20,
    durationSeconds: 100,
    playlistId: 'src',
};

function setup(scope: PersonalScope) {
    const client = new ActivitySyncClient(new MemoryActivityStore(), {
        instanceId: 'nas',
        deviceId: 'device',
        consent: () => 'consent',
        request: async () => ({ status: 200, body: {} }),
        changed: () => undefined,
        status: () => undefined,
        scope,
    });
    const localOnly = new ActivityLocalOnlyPositions(
        'nas',
        localStorage,
        undefined,
        [],
        scope
    );
    return {
        client,
        adapter: new ActivityPositionAdapter(client, undefined, localOnly),
    };
}
const rawStore = () => {
    const raw = {
        getAllPlaybackPositions: jest.fn(async () => [household]),
        savePlaybackPosition: jest.fn(async () => undefined),
        clearPlaybackPosition: jest.fn(async () => undefined),
    };
    return { raw, source: raw as unknown as IXtreamDataSource };
};

describe('activity position scope', () => {
    beforeEach(() => localStorage.clear());

    it('shows the household positions to the Default profile only', async () => {
        const { raw, source } = rawStore();
        const home = await setup('shared').adapter.invoke(
            source,
            'getAllPlaybackPositions',
            ['src']
        );
        expect(home).toEqual([household]);
        const kids = await setup(KIDS).adapter.invoke(
            source,
            'getAllPlaybackPositions',
            ['src']
        );
        expect(kids).toEqual([]);
        expect(raw.savePlaybackPosition).not.toHaveBeenCalled();
    });

    it('never writes a profile position through the household store', async () => {
        const { raw, source } = rawStore();
        const { adapter } = setup(KIDS);
        // A legacy or restore write has no session; a held-back write is local-only.
        await adapter.invoke(source, 'savePlaybackPosition', [
            'src',
            kidsMovie,
        ]);
        await adapter.invoke(
            source,
            'savePlaybackPosition',
            ['src', { ...kidsMovie, activitySessionId: 's1' }],
            true
        );
        await adapter.keepLocal(source, 'src');
        expect(raw.savePlaybackPosition).not.toHaveBeenCalled();
        expect(raw.clearPlaybackPosition).not.toHaveBeenCalled();
    });

    it('keeps a profile local-only position out of the Default profile', async () => {
        const { source } = rawStore();
        const kids = setup(KIDS).adapter;
        await kids.invoke(
            source,
            'savePlaybackPosition',
            ['src', { ...kidsMovie, activitySessionId: 's1' }],
            true
        );
        const seen = (await kids.invoke(source, 'getAllPlaybackPositions', [
            'src',
        ])) as PlaybackPositionData[];
        expect(seen.map((p) => p.contentXtreamId)).toEqual([42]);
        const home = (await setup('shared').adapter.invoke(
            source,
            'getAllPlaybackPositions',
            ['src']
        )) as PlaybackPositionData[];
        expect(home.map((p) => p.contentXtreamId)).toEqual([7]);
    });
});
