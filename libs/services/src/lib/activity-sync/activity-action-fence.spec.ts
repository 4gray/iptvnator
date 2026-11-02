import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type {
    ActivityAddress,
    ActivityContentIdentity,
} from '@iptvnator/shared/interfaces/activity-sync';
import { ActivityActionFence } from './activity-action-fence';

const position: Partial<PlaybackPositionData> = {
    contentType: 'episode',
    contentXtreamId: 42,
};
const address: ActivityAddress = {
    instanceId: 'synthetic-instance',
    scope: 'shared',
    sourceId: 'synthetic-source',
    sourceIncarnation: 'synthetic-incarnation',
    content: { provider: 'xtream', kind: 'episode', id: '42', seriesId: '7' },
};

const stalkerContent: ActivityContentIdentity = {
    provider: 'stalker',
    kind: 'episode',
    id: '42',
    seriesId: '7',
    mode: 'regular',
    seasonKey: 'synthetic-season',
    episodeNumber: 1,
};

describe('explicit activity action fence', () => {
    it('isolates other content and sources while superseding the same item', () => {
        const fence = new ActivityActionFence();
        const current = fence.position(address.sourceId, position);
        fence.position('synthetic-other', position);
        fence.position(address.sourceId, { ...position, contentXtreamId: 43 });
        expect(current()).toBe(true);
        fence.position(address.sourceId, position);
        expect(current()).toBe(false);
    });

    it('matches canonical Xtream conflict resolution to raw playback identity', () => {
        const fence = new ActivityActionFence();
        const current = fence.position(address.sourceId, position);
        fence.address(address);
        expect(current()).toBe(false);
    });

    it('matches portable Stalker episode identity across local aliases', () => {
        const fence = new ActivityActionFence();
        const stalkerAddress: ActivityAddress = {
            ...address,
            content: stalkerContent,
        };
        const current = fence.position(address.sourceId, {
            ...position,
            activityIdentity: stalkerAddress.content,
        });
        fence.address(stalkerAddress);
        expect(current()).toBe(false);
    });

    it('matches Stalker raw playback through its registered alias', () => {
        const fence = new ActivityActionFence();
        const current = fence.position(address.sourceId, position);
        fence.address(
            {
                ...address,
                content: stalkerContent,
            },
            { ...position, positionSeconds: 20 } as PlaybackPositionData
        );
        expect(current()).toBe(false);
    });
});
