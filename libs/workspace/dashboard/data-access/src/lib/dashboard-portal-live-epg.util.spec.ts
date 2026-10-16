import type {
    EpgProgram,
    PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import {
    buildDashboardPortalLiveEpgEntry,
    buildDashboardPortalLiveEpgKey,
    dashboardPortalLiveEpgProgramStopMs,
    resolveDashboardPortalLiveEpgProgram,
} from './dashboard-portal-live-epg.util';

const baseItem = (overrides: Partial<PortalActivityItem>): PortalActivityItem =>
    ({
        id: 'item-1',
        title: 'News 24',
        type: 'live',
        playlist_id: 'playlist-1',
        playlist_name: 'My portal',
        category_id: '7',
        xtream_id: 42,
        poster_url: 'https://example.com/logo.png',
        ...overrides,
    }) as PortalActivityItem;

describe('buildDashboardPortalLiveEpgEntry', () => {
    it('builds an Xtream live entry keyed by the collection uid with the stream id as tvgId', () => {
        const entry = buildDashboardPortalLiveEpgEntry(
            baseItem({ source: 'xtream', xtream_id: 42 })
        );

        expect(entry?.key).toBe('xtream::playlist-1::42');
        expect(entry?.item).toMatchObject({
            uid: 'xtream::playlist-1::42',
            name: 'News 24',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'playlist-1',
            playlistName: 'My portal',
            logo: 'https://example.com/logo.png',
            xtreamId: 42,
            tvgId: '42',
            categoryId: '7',
        });
    });

    it('accepts a numeric string Xtream id and rejects ids that cannot name a stream', () => {
        expect(
            buildDashboardPortalLiveEpgEntry(
                baseItem({ source: 'xtream', xtream_id: '17' })
            )?.item.xtreamId
        ).toBe(17);
        for (const xtream_id of ['', 'abc', 0, -3, 1.5]) {
            expect(
                buildDashboardPortalLiveEpgEntry(
                    baseItem({ source: 'xtream', xtream_id })
                )
            ).toBeNull();
        }
    });

    it('builds a Stalker live entry from the stored portal item, keyed by the extracted id', () => {
        const stalkerItem = {
            id: 'ch-9',
            cmd: 'ffrt http://portal/9',
            radio: false,
        };
        const entry = buildDashboardPortalLiveEpgEntry(
            baseItem({
                source: 'stalker',
                id: 'ch-9',
                xtream_id: 'ch-9',
                stalker_item: stalkerItem,
            })
        );

        expect(entry?.key).toBe('stalker::playlist-1::ch-9');
        expect(entry?.item).toMatchObject({
            sourceType: 'stalker',
            stalkerId: 'ch-9',
            tvgId: 'ch-9',
            stalkerCmd: 'ffrt http://portal/9',
            stalkerItem,
        });
    });

    it('skips Stalker radio rows and rows without the stored item, like the collection resolver', () => {
        expect(
            buildDashboardPortalLiveEpgEntry(
                baseItem({
                    source: 'stalker',
                    stalker_item: { id: 'r-1', radio: 'true' },
                })
            )
        ).toBeNull();
        expect(
            buildDashboardPortalLiveEpgEntry(
                baseItem({ source: 'stalker', stalker_item: undefined })
            )
        ).toBeNull();
    });

    it('leaves M3U rows and non-live rows to the XMLTV batch', () => {
        expect(
            buildDashboardPortalLiveEpgEntry(baseItem({ source: 'm3u' }))
        ).toBeNull();
        expect(
            buildDashboardPortalLiveEpgEntry(
                baseItem({ source: 'xtream', type: 'movie' })
            )
        ).toBeNull();
        expect(
            buildDashboardPortalLiveEpgKey(baseItem({ source: 'xtream' }))
        ).toBe('xtream::playlist-1::42');
        expect(
            buildDashboardPortalLiveEpgKey(baseItem({ source: 'm3u' }))
        ).toBeNull();
    });
});

describe('resolveDashboardPortalLiveEpgProgram', () => {
    it('reads the resolver map by the entry tvgId and treats a missing key as nothing on air', () => {
        const entry = buildDashboardPortalLiveEpgEntry(
            baseItem({ source: 'xtream', xtream_id: 42 })
        );
        const program = { title: 'Evening news' } as EpgProgram;
        if (!entry) throw new Error('expected an entry');

        expect(
            resolveDashboardPortalLiveEpgProgram(
                new Map([['42', program]]),
                entry
            )
        ).toBe(program);
        expect(
            resolveDashboardPortalLiveEpgProgram(new Map(), entry)
        ).toBeNull();
    });
});

describe('dashboardPortalLiveEpgProgramStopMs', () => {
    it('prefers the unix-seconds stop, falls back to the ISO string, and reports null otherwise', () => {
        expect(
            dashboardPortalLiveEpgProgramStopMs({
                stopTimestamp: 1_700_000_000,
                stop: '2026-01-01T00:00:00.000Z',
            } as EpgProgram)
        ).toBe(1_700_000_000_000);
        expect(
            dashboardPortalLiveEpgProgramStopMs({
                stop: '2026-01-01T00:00:00.000Z',
            } as EpgProgram)
        ).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
        expect(
            dashboardPortalLiveEpgProgramStopMs({
                stop: 'garbage',
            } as EpgProgram)
        ).toBeNull();
        expect(dashboardPortalLiveEpgProgramStopMs(null)).toBeNull();
    });
});
