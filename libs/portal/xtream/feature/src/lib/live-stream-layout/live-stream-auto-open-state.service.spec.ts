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
