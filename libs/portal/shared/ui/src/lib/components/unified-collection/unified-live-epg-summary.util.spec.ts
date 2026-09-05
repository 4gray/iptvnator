import { ResolvedLiveCollectionDetail } from '@iptvnator/portal/shared/data-access';
import { getLiveEpgPanelSummary } from './unified-live-epg-summary.util';

const HOUR_S = 3600;

describe('getLiveEpgPanelSummary', () => {
    const nowSeconds = 1_800_000_000;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(nowSeconds * 1000);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    function m3uDetail(): ResolvedLiveCollectionDetail {
        const program = (title: string, startS: number, stopS: number) => ({
            title,
            start: new Date(startS * 1000).toISOString(),
            stop: new Date(stopS * 1000).toISOString(),
            channel: 'ch',
            desc: null,
            category: null,
        });
        return {
            epgMode: 'm3u',
            epgPrograms: [
                program(
                    'Earlier',
                    nowSeconds - 2 * HOUR_S,
                    nowSeconds - HOUR_S
                ),
                program(
                    'Provider now',
                    nowSeconds - HOUR_S,
                    nowSeconds + HOUR_S
                ),
            ],
        } as unknown as ResolvedLiveCollectionDetail;
    }

    function portalDetail(): ResolvedLiveCollectionDetail {
        const item = (title: string, startS: number, stopS: number) => ({
            title,
            start: new Date(startS * 1000).toISOString(),
            end: new Date(stopS * 1000).toISOString(),
            start_timestamp: String(startS),
            stop_timestamp: String(stopS),
        });
        return {
            epgMode: 'portal',
            epgItems: [
                item('Earlier', nowSeconds - 2 * HOUR_S, nowSeconds - HOUR_S),
                item('Provider now', nowSeconds - HOUR_S, nowSeconds + HOUR_S),
            ],
        } as unknown as ResolvedLiveCollectionDetail;
    }

    it('summarises the programme airing right now without an offset', () => {
        expect(getLiveEpgPanelSummary(m3uDetail())?.title).toBe('Provider now');
        expect(getLiveEpgPanelSummary(portalDetail())?.title).toBe(
            'Provider now'
        );
    });

    it('applies the display offset to both EPG shapes before picking the current programme', () => {
        // The guide runs 90 minutes ahead: the show the provider filed as
        // finished an hour ago is the one really on air.
        expect(getLiveEpgPanelSummary(m3uDetail(), 90)?.title).toBe('Earlier');
        expect(getLiveEpgPanelSummary(portalDetail(), 90)?.title).toBe(
            'Earlier'
        );
    });

    it('hands the summary over with the provider raw times', () => {
        const summary = getLiveEpgPanelSummary(portalDetail(), 90);
        expect(summary?.start).toBe(
            new Date((nowSeconds - 2 * HOUR_S) * 1000).toISOString()
        );
    });
});
