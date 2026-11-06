import { getSeriesNextUp } from '@iptvnator/portal/shared/util';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { activitySyncFixture } from './test-stubs/activity-sync-fixture.stub';

const episode: XtreamSerieEpisode = {
    id: '101',
    episode_num: 1,
    title: 'Synthetic episode',
    container_extension: 'mp4',
    info: [],
    custom_sid: '',
    added: '',
    season: 1,
    direct_source: '',
};

describe('explicit import of mirrored Stalker episode activity', () => {
    afterEach(() => localStorage.clear());
    it.each([0, undefined])(
        'preserves reset or zero-start quick-start semantics (duration: %s)',
        async (durationSeconds) => {
            const f = activitySyncFixture();
            f.client.acceptContext({
                sourceId: f.address.sourceId,
                sourceIncarnation: f.address.sourceIncarnation,
                provider: 'stalker',
            });
            const position: PlaybackPositionData = {
                playlistId: f.address.sourceId,
                contentType: 'episode',
                contentXtreamId: 101,
                seriesXtreamId: 100,
                seasonNumber: 1,
                episodeNumber: 1,
                positionSeconds: 0,
                durationSeconds,
                watched: false,
                activityIdentity: {
                    provider: 'stalker',
                    kind: 'episode',
                    mode: 'regular',
                    seriesId: '100',
                    id: '101',
                    seasonKey: '1',
                    episodeNumber: 1,
                },
            };
            await f.raw.savePlaybackPosition(f.address.sourceId, position);
            await f.client.importPosition(f.address.sourceId, position);
            await f.client.flush();
            const positions = (await f.adapter.invoke(
                f.raw,
                'getSeriesPlaybackPositions',
                [f.address.sourceId, 100]
            )) as PlaybackPositionData[];
            expect(
                getSeriesNextUp({
                    seasons: { '1': [episode] },
                    playbackPositions: new Map(
                        positions.map((p) => [p.contentXtreamId, p])
                    ),
                })?.kind
            ).toBe(durationSeconds === 0 ? 'start' : 'resume');
        }
    );
});
