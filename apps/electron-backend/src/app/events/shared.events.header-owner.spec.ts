import type { BeforeSendResponse } from 'electron';

type IpcHandler = (event: unknown, ...args: unknown[]) => boolean;
type WebRequestListener = (
    details: { url: string; requestHeaders: Record<string, string> },
    callback: (result: BeforeSendResponse) => void
) => void;

const mockHandle = jest.fn<void, [string, IpcHandler]>();
const mockOnBeforeSendHeaders = jest.fn<void, [unknown, WebRequestListener]>();

jest.mock('electron', () => ({
    ipcMain: { handle: mockHandle },
    session: {
        defaultSession: {
            webRequest: { onBeforeSendHeaders: mockOnBeforeSendHeaders },
        },
    },
}));

const TILE = 'multiview-tile-2';
const stream = 'https://tile.example/live/2.m3u8';
const segment = 'https://tile.example/live/2-001.ts';

function requestHeaders(url: string): Record<string, string | string[]> {
    const listener = mockOnBeforeSendHeaders.mock.calls[0]?.[1];
    if (!listener) return {};
    const callback = jest.fn<void, [BeforeSendResponse]>();
    listener({ url, requestHeaders: {} }, callback);
    return callback.mock.calls[0][0].requestHeaders ?? {};
}

function createSender(id: number) {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const sender = {
        id,
        on: (event: string, listener: (...args: unknown[]) => void) => {
            listeners.set(
                event,
                (listeners.get(event) ?? new Set()).add(listener)
            );
            return sender;
        },
        off: (event: string, listener: (...args: unknown[]) => void) => {
            listeners.get(event)?.delete(listener);
            return sender;
        },
    };
    return {
        event: { sender },
        emit: (event: string, ...args: unknown[]) => {
            for (const listener of [...(listeners.get(event) ?? [])]) {
                listener(...args);
            }
        },
        listenerCount: () =>
            [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    };
}

describe('multiview header owners and their page', () => {
    let configure: IpcHandler;
    let release: IpcHandler;

    const handler = (channel: string): IpcHandler => {
        const registration = mockHandle.mock.calls.find(
            ([name]) => name === channel
        );
        if (!registration) throw new Error(`Missing ${channel} IPC handler`);
        return registration[1];
    };

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        await import('./shared.events');
        configure = handler('set-user-agent');
        release = handler('release-header-owner');
    });

    function configureTile(page: ReturnType<typeof createSender>): void {
        configure(
            page.event,
            'SyntheticTileAgent',
            undefined,
            stream,
            { cookie: 'tile=synthetic' },
            undefined,
            TILE
        );
    }

    it('forgets a tile when its page loads a new document', () => {
        const page = createSender(1);
        configureTile(page);
        expect(requestHeaders(segment)).toMatchObject({
            'User-Agent': 'SyntheticTileAgent',
            Cookie: 'tile=synthetic',
        });

        // Angular routing keeps the page and the tile.
        page.emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: true,
        });
        expect(requestHeaders(segment)['Cookie']).toBe('tile=synthetic');

        page.emit('did-start-navigation', {
            isMainFrame: true,
            isSameDocument: false,
        });
        expect(requestHeaders(segment)['Cookie']).toBeUndefined();
        expect(requestHeaders(segment)['User-Agent']).toBeUndefined();
        expect(page.listenerCount()).toBe(0);
    });

    it.each(['render-process-gone', 'destroyed'])(
        'forgets a tile when its page is gone (%s)',
        (gone) => {
            const page = createSender(1);
            configureTile(page);

            page.emit(gone);

            expect(requestHeaders(segment)['Cookie']).toBeUndefined();
        }
    );

    it('stops watching a tile the page released itself', () => {
        const page = createSender(1);
        configureTile(page);
        release(page.event, TILE);
        expect(requestHeaders(segment)['Cookie']).toBeUndefined();

        // A later tile with the same id belongs to the page again.
        configureTile(page);
        page.emit('render-process-gone');
        expect(requestHeaders(segment)['Cookie']).toBeUndefined();
    });

    it('leaves the single player default owner to its own page', () => {
        const page = createSender(1);
        configure(page.event, 'SyntheticAgent', undefined, stream);

        expect(page.listenerCount()).toBe(0);
    });
});
