import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistFileImportService } from '@iptvnator/playlist/shared/util';
import type { ElectronBridgePlaylistOpenRequest } from '@iptvnator/shared/interfaces';
import { PlaylistOpenRequestService } from './playlist-open-request.service';

type BridgeMock = {
    acknowledgePlaylistOpenRequest: jest.Mock;
    announcePlaylistOpenListener: jest.Mock;
    onPlaylistOpenRequest: jest.Mock;
};

describe('PlaylistOpenRequestService', () => {
    let service: PlaylistOpenRequestService;
    let importService: { importFromPath: jest.Mock };
    let snackBar: { open: jest.Mock };
    let bridge: BridgeMock;
    let pushRequest: (request: ElectronBridgePlaylistOpenRequest) => void;
    let unsubscribe: jest.Mock;
    let originalElectron: typeof window.electron | undefined;

    const request = (name: string): ElectronBridgePlaylistOpenRequest => ({
        fileName: `${name}.m3u`,
        filePath: `/tmp/${name}.m3u`,
        requestId: name,
    });

    /** Lets every queued promise callback settle. */
    const settle = () =>
        new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    beforeEach(() => {
        originalElectron = window.electron;
        pushRequest = () => undefined;
        unsubscribe = jest.fn();
        importService = {
            importFromPath: jest.fn().mockResolvedValue({
                ok: true,
                title: 'Playlist',
            }),
        };
        snackBar = { open: jest.fn() };
        bridge = {
            acknowledgePlaylistOpenRequest: jest
                .fn()
                .mockResolvedValue(undefined),
            announcePlaylistOpenListener: jest
                .fn()
                .mockResolvedValue(undefined),
            onPlaylistOpenRequest: jest.fn((callback) => {
                pushRequest = callback;
                return unsubscribe;
            }),
        };
        window.electron = bridge as unknown as typeof window.electron;

        TestBed.configureTestingModule({
            providers: [
                PlaylistOpenRequestService,
                { provide: PlaylistFileImportService, useValue: importService },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });

        service = TestBed.inject(PlaylistOpenRequestService);
    });

    afterEach(() => {
        window.electron = originalElectron as typeof window.electron;
        jest.restoreAllMocks();
    });

    // The announcement makes the main process flush its queue at once, so a
    // listener attached afterwards would miss every startup file.
    it('subscribes before announcing itself', () => {
        service.start();

        expect(
            bridge.onPlaylistOpenRequest.mock.invocationCallOrder[0]
        ).toBeLessThan(
            bridge.announcePlaylistOpenListener.mock.invocationCallOrder[0]
        );
    });

    it('imports a playlist the main process pushes', async () => {
        service.start();
        pushRequest(request('startup'));
        await settle();

        expect(importService.importFromPath).toHaveBeenCalledWith(
            '/tmp/startup.m3u',
            'startup.m3u'
        );
    });

    // `send()` returns before the listener runs, so the main process holds the
    // request until this confirms a live renderer got it.
    it('acknowledges a request as soon as it arrives', async () => {
        importService.importFromPath.mockReturnValue(new Promise(() => undefined));

        service.start();
        pushRequest(request('startup'));

        expect(bridge.acknowledgePlaylistOpenRequest).toHaveBeenCalledWith(
            'startup'
        );
    });

    it('keeps importing when acknowledging fails', async () => {
        bridge.acknowledgePlaylistOpenRequest.mockRejectedValue(
            new Error('gone')
        );

        service.start();
        pushRequest(request('startup'));
        await settle();

        expect(importService.importFromPath).toHaveBeenCalledWith(
            '/tmp/startup.m3u',
            'startup.m3u'
        );
    });

    it('reports a failed import to the user', async () => {
        importService.importFromPath.mockResolvedValue({
            ok: false,
            reason: 'read-error',
        });

        service.start();
        pushRequest(request('broken'));
        await settle();

        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.FILE_UPLOAD.OPEN_FAILED',
            'CLOSE',
            expect.objectContaining({ panelClass: ['error-snackbar'] })
        );
    });

    // The main-process queue flushes back to back, so a burst of pushes must
    // not fan out into parallel file reads landing in arbitrary order — the
    // last playlist imported is the one the app navigates to.
    it('never runs two imports at the same time', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const resolvers: (() => void)[] = [];

        importService.importFromPath.mockImplementation(() => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);

            return new Promise((resolvePromise) => {
                resolvers.push(() => {
                    inFlight -= 1;
                    resolvePromise({ ok: true, title: 'Playlist' });
                });
            });
        });

        service.start();
        pushRequest(request('one'));
        pushRequest(request('two'));
        pushRequest(request('three'));

        for (let step = 0; step < 12; step += 1) {
            resolvers.shift()?.();
            await settle();
        }

        expect(maxInFlight).toBe(1);
        expect(
            importService.importFromPath.mock.calls.map(([path]) => path)
        ).toEqual(['/tmp/one.m3u', '/tmp/two.m3u', '/tmp/three.m3u']);
    });

    it('keeps importing after one file fails', async () => {
        importService.importFromPath
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce({ ok: true, title: 'Playlist' });

        service.start();
        pushRequest(request('broken'));
        pushRequest(request('healthy'));
        await settle();

        expect(importService.importFromPath).toHaveBeenCalledWith(
            '/tmp/healthy.m3u',
            'healthy.m3u'
        );
    });

    it('starts only once', () => {
        service.start();
        service.start();

        expect(bridge.announcePlaylistOpenListener).toHaveBeenCalledTimes(1);
    });

    it('does nothing without the Electron bridge', () => {
        window.electron = undefined as unknown as typeof window.electron;

        expect(() => service.start()).not.toThrow();
        expect(importService.importFromPath).not.toHaveBeenCalled();
    });

    it('releases the listener on stop', () => {
        service.start();
        service.stop();

        expect(unsubscribe).toHaveBeenCalled();
    });
});
