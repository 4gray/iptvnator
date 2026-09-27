import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { PlaybackHistoryGate } from './playback-history-gate.service';

describe('PlaybackHistoryGate', () => {
    let gate: PlaybackHistoryGate;

    beforeEach(() => {
        gate = new PlaybackHistoryGate();
    });

    it('holds a write until its playback is confirmed', () => {
        const commit = jest.fn();
        gate.defer(
            { sessionKey: 'live:p1:c1', streamUrls: ['http://stream/1'] },
            commit
        );

        expect(commit).not.toHaveBeenCalled();

        gate.confirm({ sessionKey: 'live:p1:c1' });

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('never commits a write whose stream is not confirmed', () => {
        const failed = jest.fn();
        const played = jest.fn();
        gate.defer({ streamUrls: ['http://stream/failed'] }, failed);
        gate.defer({ streamUrls: ['http://stream/played'] }, played);

        gate.confirm({ streamUrls: ['http://stream/played'] });

        expect(failed).not.toHaveBeenCalled();
        expect(played).toHaveBeenCalledTimes(1);
    });

    it('does not let the same URL played in another playlist confirm a write', () => {
        // Playlist A's attempt failed; the same stream then plays in B.
        const failedInA = jest.fn();
        const playedInB = jest.fn();
        gate.defer(
            { sessionKey: 'live:a:c1', streamUrls: ['http://shared/1'] },
            failedInA
        );
        gate.defer(
            { sessionKey: 'live:b:c9', streamUrls: ['http://shared/1'] },
            playedInB
        );

        gate.confirm({
            sessionKey: 'live:b:c9',
            streamUrls: ['http://shared/1'],
        });

        expect(failedInA).not.toHaveBeenCalled();
        expect(playedInB).toHaveBeenCalledTimes(1);
    });

    it('does not let a URL-only confirmation commit a write deferred with a session key', () => {
        // Playlist A's attempt failed; the same URL then opens in MPV/VLC,
        // whose app-wide session confirmation carries no session key.
        const failedInA = jest.fn();
        gate.defer(
            { sessionKey: 'live:a:c1', streamUrls: ['http://shared/1'] },
            failedInA
        );

        gate.confirm({ streamUrls: ['http://shared/1'] });

        expect(failedInA).not.toHaveBeenCalled();
    });

    it('matches writes without a session key by stream URL', () => {
        const portalWrite = jest.fn();
        const externalWrite = jest.fn();
        gate.defer({ streamUrls: ['http://portal/tmp'] }, portalWrite);
        gate.defer({ streamUrls: ['http://portal/vod'] }, externalWrite);

        // An inline player (with its own key) and an MPV/VLC session.
        gate.confirm({
            sessionKey: 'live:portal:9',
            streamUrls: ['http://portal/tmp'],
        });
        gate.confirm({ streamUrls: ['http://portal/vod'] });

        expect(portalWrite).toHaveBeenCalledTimes(1);
        expect(externalWrite).toHaveBeenCalledTimes(1);
    });

    it('commits each confirmed write once', () => {
        const commit = jest.fn();
        gate.defer({ streamUrls: ['http://stream/1'] }, commit);

        gate.confirm({ streamUrls: ['http://stream/1'] });
        gate.confirm({ streamUrls: ['http://stream/1'] });

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('commits every writer deferred for the same playback', () => {
        const first = jest.fn();
        const second = jest.fn();
        gate.defer({ streamUrls: ['http://stream/1'] }, first);
        gate.defer({ streamUrls: ['http://stream/1'] }, second);

        gate.confirm({ streamUrls: ['http://stream/1'] });

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('commits immediately when a write has nothing to match on', () => {
        const commit = jest.fn();

        gate.defer({ sessionKey: ' ', streamUrls: [undefined, null] }, commit);

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('ignores confirmations with nothing to match on', () => {
        const commit = jest.fn();
        gate.defer({ streamUrls: ['http://stream/1'] }, commit);

        gate.confirm({ streamUrls: [undefined, ''] });

        expect(commit).not.toHaveBeenCalled();
    });

    it('drops the oldest unconfirmed writes beyond its bound', () => {
        const oldest = jest.fn();
        gate.defer({ streamUrls: ['http://stream/oldest'] }, oldest);
        for (let index = 0; index < 20; index += 1) {
            gate.defer({ streamUrls: [`http://stream/${index}`] }, jest.fn());
        }

        gate.confirm({ streamUrls: ['http://stream/oldest'] });

        expect(oldest).not.toHaveBeenCalled();
    });

    describe('MPV/VLC sessions', () => {
        const originalElectron = window.electron;
        let emit: (session: Partial<ExternalPlayerSession>) => void;

        beforeEach(() => {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: {
                    onExternalPlayerSessionUpdate: (
                        callback: (session: ExternalPlayerSession) => void
                    ) => {
                        emit = (session) =>
                            callback({
                                streamUrl: 'http://vod/1.mkv',
                                ...session,
                            } as ExternalPlayerSession);
                        return () => undefined;
                    },
                },
            });
            gate = new PlaybackHistoryGate();
        });

        afterEach(() => {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: originalElectron,
            });
        });

        it('confirms a stream once its external player has opened', () => {
            const commit = jest.fn();
            gate.defer({ streamUrls: ['http://vod/1.mkv'] }, commit);

            emit({ status: 'launching' });
            expect(commit).not.toHaveBeenCalled();

            emit({ status: 'opened' });
            expect(commit).toHaveBeenCalledTimes(1);
        });

        it('does not confirm a launch that failed', () => {
            const commit = jest.fn();
            gate.defer({ streamUrls: ['http://vod/1.mkv'] }, commit);

            emit({ status: 'launching' });
            emit({ status: 'error' });

            expect(commit).not.toHaveBeenCalled();
        });
    });

    it('keeps committing the other writes when one throws', () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const failing = jest.fn(() => {
            throw new Error('db down');
        });
        const healthy = jest.fn();
        gate.defer({ streamUrls: ['http://stream/1'] }, failing);
        gate.defer({ streamUrls: ['http://stream/1'] }, healthy);

        gate.confirm({ streamUrls: ['http://stream/1'] });

        expect(healthy).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });
});
