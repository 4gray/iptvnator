import { TestBed } from '@angular/core/testing';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';

const STREAM_A = 'https://a.example/live/one.m3u8';
const STREAM_B = 'https://b.example/live/two.m3u8';
const PLAYBACK_A = {
    streamUrl: STREAM_A,
    title: 'Synthetic A',
    userAgent: 'AgentA/1.0',
    headers: { Cookie: 'session=a' },
};
const PLAYBACK_B = {
    streamUrl: STREAM_B,
    title: 'Synthetic B',
    userAgent: 'AgentB/1.0',
};

describe('ElectronStreamHeadersService owners', () => {
    let service: ElectronStreamHeadersService;
    let setUserAgent: jest.Mock;

    beforeEach(() => {
        setUserAgent = jest.fn().mockResolvedValue(true);
        (window as unknown as { electron?: unknown }).electron = {
            setUserAgent,
        };
        service = TestBed.inject(ElectronStreamHeadersService);
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('sends exactly the single-slot arguments when no owner is given', async () => {
        await service.apply(PLAYBACK_A);
        service.clear(STREAM_A);

        expect(setUserAgent.mock.calls).toEqual([
            [
                'AgentA/1.0',
                undefined,
                STREAM_A,
                { cookie: 'session=a' },
                undefined,
            ],
            [undefined, undefined, STREAM_A],
        ]);
    });

    it('treats a null owner as the default slot', async () => {
        await service.apply(PLAYBACK_A, null);
        service.clear(STREAM_A, null);

        expect(setUserAgent.mock.calls).toEqual([
            [
                'AgentA/1.0',
                undefined,
                STREAM_A,
                { cookie: 'session=a' },
                undefined,
            ],
            [undefined, undefined, STREAM_A],
        ]);
    });

    it('passes a named owner as the sixth argument on apply and clear', async () => {
        await service.apply(PLAYBACK_B, 'tile-b');
        service.clear(STREAM_B, 'tile-b');

        expect(setUserAgent.mock.calls).toEqual([
            ['AgentB/1.0', undefined, STREAM_B, undefined, undefined, 'tile-b'],
            [undefined, undefined, STREAM_B, undefined, undefined, 'tile-b'],
        ]);
    });

    it('does not supersede another owner pending apply', async () => {
        const resolvers: Array<() => void> = [];
        setUserAgent.mockImplementation(
            () =>
                new Promise<boolean>((resolve) =>
                    resolvers.push(() => resolve(true))
                )
        );

        const defaultApply = service.apply(PLAYBACK_A);
        const tileApply = service.apply(PLAYBACK_B, 'tile-b');
        resolvers.forEach((resolve) => resolve());

        await expect(defaultApply).resolves.toBe(true);
        await expect(tileApply).resolves.toBe(true);
    });

    it('supersedes only applies of the same owner', async () => {
        const resolvers: Array<() => void> = [];
        setUserAgent.mockImplementation(
            () =>
                new Promise<boolean>((resolve) =>
                    resolvers.push(() => resolve(true))
                )
        );

        const first = service.apply(PLAYBACK_A, 'tile-b');
        const second = service.apply(PLAYBACK_B, 'tile-b');
        const other = service.apply(PLAYBACK_A, 'tile-c');
        resolvers.forEach((resolve) => resolve());

        await expect(first).resolves.toBe(false);
        await expect(second).resolves.toBe(true);
        await expect(other).resolves.toBe(true);
    });

    it('releases only the slot of the owner that clears', async () => {
        await service.apply(PLAYBACK_A);
        await service.apply(PLAYBACK_B, 'tile-b');
        setUserAgent.mockClear();

        // Same stream URL, but the default owner never configured it.
        service.clear(STREAM_B);
        // A named owner cannot release the default slot either.
        service.clear(STREAM_A, 'tile-b');
        expect(setUserAgent).not.toHaveBeenCalled();

        service.clear(STREAM_B, 'tile-b');
        expect(setUserAgent.mock.calls).toEqual([
            [undefined, undefined, STREAM_B, undefined, undefined, 'tile-b'],
        ]);

        setUserAgent.mockClear();
        service.clear(STREAM_A);
        expect(setUserAgent.mock.calls).toEqual([
            [undefined, undefined, STREAM_A],
        ]);
    });

    it('reports a pending apply as stale once its owner cleared', async () => {
        let resolveApply: () => void = () => undefined;
        setUserAgent.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    resolveApply = () => resolve(true);
                })
        );

        const pending = service.apply(PLAYBACK_B, 'tile-b');
        service.clear(STREAM_B, 'tile-b');
        resolveApply();

        await expect(pending).resolves.toBe(false);
    });

    it('returns null for every owner without an Electron bridge (PWA)', () => {
        delete (window as unknown as { electron?: unknown }).electron;

        expect(service.apply(PLAYBACK_A)).toBeNull();
        expect(service.apply(PLAYBACK_B, 'tile-b')).toBeNull();
        expect(() => service.clear(STREAM_B, 'tile-b')).not.toThrow();
    });
});
