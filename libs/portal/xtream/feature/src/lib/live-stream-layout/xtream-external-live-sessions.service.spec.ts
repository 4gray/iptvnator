import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import { XtreamExternalLiveSessions } from './xtream-external-live-sessions.service';

const oldUrl = 'https://example.test/old.ts';
const newUrl = 'https://example.test/new.ts';
const original = { playlistId: 'synthetic-playlist', categoryId: 1 };
const replacement = { ...original, categoryId: 2 };

function session(
    id: string,
    streamUrl: string,
    status: ExternalPlayerSession['status']
): ExternalPlayerSession {
    return {
        id,
        streamUrl,
        status,
        player: 'mpv',
        title: 'Synthetic Channel',
        startedAt: '2026-04-04T10:00:00Z',
        updatedAt: '2026-04-04T10:00:00Z',
        canClose: status === 'opened' || status === 'error',
    };
}

describe('XtreamExternalLiveSessions', () => {
    let guard: XtreamExternalLiveSessions;
    let receive: (value: ExternalPlayerSession) => void;
    let previousElectron: Window['electron'];
    const locked = signal(false);
    const version = signal(0);
    const closeSession = jest.fn(
        async (_session: ExternalPlayerSession) => undefined
    );

    function relock() {
        locked.set(true);
        version.update((value) => value + 1);
        TestBed.flushEffects();
    }

    beforeEach(() => {
        previousElectron = window.electron;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                onExternalPlayerSessionUpdate: (callback: typeof receive) => {
                    receive = callback;
                    return () => undefined;
                },
            },
        });
        closeSession.mockClear();
        locked.set(false);
        version.set(0);
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { closeSession, activeSession: signal(null) },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        version,
                        active: locked,
                        isXtreamCategoryLocked: (
                            _playlist: string,
                            _type: string,
                            category: number
                        ) => locked() && category === 1,
                    },
                },
            ],
        });
        guard = TestBed.inject(XtreamExternalLiveSessions);
    });

    afterEach(() =>
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: previousElectron,
        })
    );

    it.each(['event', 'result'] as const)(
        'closes a superseded launch that becomes closable after relock (%s)',
        (delivery) => {
            const finishOld = guard.begin(oldUrl, original);
            receive(session('old', oldUrl, 'launching'));
            const finishNew = guard.begin(newUrl, replacement);
            const newer = session('new', newUrl, 'opened');
            receive(newer);
            finishNew(newer);
            relock();
            expect(closeSession).not.toHaveBeenCalled();

            const older = session('old', oldUrl, 'opened');
            if (delivery === 'event') receive(older);
            finishOld(older);
            expect(closeSession).toHaveBeenCalledTimes(1);
            expect(closeSession).toHaveBeenCalledWith(older);
        }
    );

    it('keeps superseded sessions only until their terminal event', () => {
        const old = session('old', oldUrl, 'opened');
        guard.begin(oldUrl, original)(old);
        guard.begin(newUrl, replacement)(session('new', newUrl, 'opened'));
        relock();
        expect(closeSession).toHaveBeenCalledWith(old);

        receive(session('old', oldUrl, 'closed'));
        closeSession.mockClear();
        version.update((value) => value + 1);
        TestBed.flushEffects();
        expect(closeSession).not.toHaveBeenCalled();
    });

    it('closes an older native session by ID without dismissing the current dock', async () => {
        const nativeClose = jest.fn(async (id: string) =>
            session(id, oldUrl, 'closed')
        );
        Object.defineProperty(window.electron, 'closeExternalPlayerSession', {
            value: nativeClose,
        });
        guard.begin(oldUrl, original)(session('old', oldUrl, 'opened'));
        relock();
        expect(nativeClose).toHaveBeenCalledWith('old');
        expect(closeSession).not.toHaveBeenCalled();
        await Promise.resolve();
        version.update((value) => value + 1);
        TestBed.flushEffects();
        expect(nativeClose).toHaveBeenCalledTimes(1);
    });
});
