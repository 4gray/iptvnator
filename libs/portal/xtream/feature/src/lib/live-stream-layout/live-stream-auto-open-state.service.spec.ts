import { LiveStreamAutoOpenStateService } from './live-stream-auto-open-state.service';

describe('LiveStreamAutoOpenStateService', () => {
    let service: LiveStreamAutoOpenStateService;

    beforeEach(() => {
        service = new LiveStreamAutoOpenStateService();
        window.history.replaceState({}, document.title);
    });

    afterEach(() => {
        window.history.replaceState({}, document.title);
    });

    it('captures a positive live item id from history state', () => {
        window.history.replaceState(
            { openXtreamLiveItemId: 101 },
            document.title
        );

        service.captureFromHistoryState();

        expect(service.pendingItemId()).toBe(101);
        expect(service.pendingPlaylistId()).toBeNull();
    });

    it('captures the owning playlist id beside the item id', () => {
        window.history.replaceState(
            { openXtreamLiveItemId: 101, openXtreamLivePlaylistId: ' pl-2 ' },
            document.title
        );

        service.captureFromHistoryState();

        expect(service.pendingItemId()).toBe(101);
        expect(service.pendingPlaylistId()).toBe('pl-2');
    });

    it('drops both keys and the playlist id when the item is consumed', () => {
        window.history.replaceState(
            {
                openXtreamLiveItemId: 101,
                openXtreamLivePlaylistId: 'pl-2',
                openXtreamLiveTitle: 'T',
                openXtreamLivePoster: 'p.png',
                keep: true,
            },
            document.title
        );
        service.captureFromHistoryState();

        service.clearPendingItem();
        service.clearHistoryState();

        expect(service.pendingPlaylistId()).toBeNull();
        expect(window.history.state).toEqual({ keep: true });
    });

    it('clears the pending item id when history state has no live item id', () => {
        window.history.replaceState(
            { openXtreamLiveItemId: 101 },
            document.title
        );
        service.captureFromHistoryState();

        window.history.replaceState({}, document.title);
        service.captureFromHistoryState();

        expect(service.pendingItemId()).toBeNull();
    });
});
