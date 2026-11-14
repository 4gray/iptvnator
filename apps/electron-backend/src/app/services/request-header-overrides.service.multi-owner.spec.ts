type HeaderListener = (
    details: Electron.OnBeforeSendHeadersListenerDetails,
    callback: (beforeSendResponse: Electron.BeforeSendResponse) => void
) => void;

const mockOnBeforeSendHeaders = jest.fn();

jest.mock('electron', () => ({
    session: {
        defaultSession: {
            webRequest: {
                onBeforeSendHeaders: mockOnBeforeSendHeaders,
            },
        },
    },
}));

const TILE_A = 'tile-a';
const TILE_B = 'tile-b';
const STREAM_A = 'https://a.example/live/one.m3u8';
const STREAM_B = 'https://b.example/live/two.m3u8';

function headersFor(
    url: string,
    requestHeaders: Record<string, string> = {}
): Record<string, string> {
    const listener = mockOnBeforeSendHeaders.mock.calls[0][1] as HeaderListener;
    let response: Electron.BeforeSendResponse | undefined;
    listener(
        {
            id: 1,
            method: 'GET',
            referrer: '',
            requestHeaders,
            resourceType: 'media',
            timestamp: Date.now(),
            uploadData: [],
            url,
            webContentsId: 1,
            webContents: undefined,
        } as Electron.OnBeforeSendHeadersListenerDetails,
        (nextResponse) => {
            response = nextResponse;
        }
    );
    if (!response?.requestHeaders) {
        throw new Error('Expected request headers response');
    }
    return response.requestHeaders as Record<string, string>;
}

async function loadService() {
    return import('./request-header-overrides.service');
}

describe('request header overrides per owner', () => {
    beforeEach(() => {
        jest.resetModules();
        mockOnBeforeSendHeaders.mockClear();
    });

    it('keeps one independent scoped override per owner', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride(
            'AgentA/1.0',
            'https://a.example/watch',
            STREAM_A,
            { cookie: 'session=a', authorization: 'Bearer A' },
            undefined,
            TILE_A
        );
        configureRequestHeaderOverride(
            'AgentB/1.0',
            undefined,
            STREAM_B,
            { cookie: 'session=b' },
            'https://origin-b.example',
            TILE_B
        );

        expect(mockOnBeforeSendHeaders).toHaveBeenCalledTimes(1);
        expect(headersFor('https://a.example/live/segment-1.ts')).toEqual({
            Authorization: 'Bearer A',
            Cookie: 'session=a',
            Origin: 'https://a.example',
            Referer: 'https://a.example/watch',
            'User-Agent': 'AgentA/1.0',
        });
        expect(headersFor('https://b.example/live/segment-1.ts')).toEqual({
            Cookie: 'session=b',
            Origin: 'https://origin-b.example',
            'User-Agent': 'AgentB/1.0',
        });
        expect(headersFor('https://other.example/asset.png')).toEqual({});
    });

    it('never sends one owner credentials to another owner origin', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride(
            undefined,
            undefined,
            STREAM_A,
            { cookie: 'session=a', authorization: 'Bearer A' },
            undefined,
            TILE_A
        );
        configureRequestHeaderOverride(
            'AgentB/1.0',
            undefined,
            STREAM_B,
            undefined,
            undefined,
            TILE_B
        );

        expect(headersFor(STREAM_B)).toEqual({ 'User-Agent': 'AgentB/1.0' });
    });

    it('clears only the owner that sends an empty scoped call', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride(
            'AgentA/1.0',
            undefined,
            STREAM_A,
            undefined,
            undefined,
            TILE_A
        );
        configureRequestHeaderOverride(
            'AgentB/1.0',
            undefined,
            STREAM_B,
            undefined,
            undefined,
            TILE_B
        );

        configureRequestHeaderOverride(
            undefined,
            undefined,
            STREAM_A,
            undefined,
            undefined,
            TILE_A
        );

        expect(headersFor(STREAM_A)).toEqual({});
        expect(headersFor(STREAM_B)).toEqual({ 'User-Agent': 'AgentB/1.0' });
    });

    it('keeps the default owner separate from named owners', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride('DefaultAgent/1.0', undefined, STREAM_A);
        configureRequestHeaderOverride(
            'AgentB/1.0',
            undefined,
            STREAM_B,
            undefined,
            undefined,
            TILE_B
        );

        // The default owner behaves as the single slot did: the next scoped
        // call without an owner replaces it and leaves named owners alone.
        configureRequestHeaderOverride(
            'NextAgent/1.0',
            undefined,
            'https://c.example/live/three.m3u8'
        );

        expect(headersFor(STREAM_A)).toEqual({});
        expect(headersFor('https://c.example/live/seg.ts')).toEqual({
            'User-Agent': 'NextAgent/1.0',
        });
        expect(headersFor(STREAM_B)).toEqual({ 'User-Agent': 'AgentB/1.0' });

        configureRequestHeaderOverride(
            undefined,
            undefined,
            'https://c.example/live/three.m3u8'
        );
        expect(headersFor('https://c.example/live/seg.ts')).toEqual({});
        expect(headersFor(STREAM_B)).toEqual({ 'User-Agent': 'AgentB/1.0' });
    });

    it('clears the playlist override and every owner on an empty global call', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride('PlaylistAgent/1.0');
        configureRequestHeaderOverride('DefaultAgent/1.0', undefined, STREAM_A);
        configureRequestHeaderOverride(
            'AgentB/1.0',
            undefined,
            STREAM_B,
            undefined,
            undefined,
            TILE_B
        );

        configureRequestHeaderOverride(undefined, undefined);

        expect(headersFor(STREAM_A)).toEqual({});
        expect(headersFor(STREAM_B)).toEqual({});
        expect(headersFor('https://other.example/x')).toEqual({});
    });

    it('keeps the playlist override for requests no tile claims', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            'https://playlist.example/'
        );
        configureRequestHeaderOverride(
            'AgentB/1.0',
            undefined,
            STREAM_B,
            undefined,
            undefined,
            TILE_B
        );

        // A tile's request carries its own headers only (round 6 review).
        expect(headersFor(STREAM_B)).toEqual({ 'User-Agent': 'AgentB/1.0' });
        expect(headersFor(STREAM_A)).toEqual({
            Origin: 'https://playlist.example',
            Referer: 'https://playlist.example/',
            'User-Agent': 'PlaylistAgent/1.0',
        });
    });

    describe('two owners on the same origin', () => {
        const FIRST = 'https://shared.example/live/first.ts';
        const SECOND = 'https://shared.example/live/second.ts';

        it('gives an exact stream URL its own override', async () => {
            const { configureRequestHeaderOverride } = await loadService();
            configureRequestHeaderOverride(
                'AgentA/1.0',
                undefined,
                FIRST,
                { cookie: 'session=a' },
                undefined,
                TILE_A
            );
            configureRequestHeaderOverride(
                'AgentB/1.0',
                undefined,
                SECOND,
                { cookie: 'session=b' },
                undefined,
                TILE_B
            );

            expect(headersFor(FIRST)).toEqual({
                Cookie: 'session=a',
                'User-Agent': 'AgentA/1.0',
            });
            expect(headersFor(SECOND)).toEqual({
                Cookie: 'session=b',
                'User-Agent': 'AgentB/1.0',
            });
        });

        it("keeps another owner's credentials off a header-free owner's stream", async () => {
            const { configureRequestHeaderOverride } = await loadService();
            configureRequestHeaderOverride(
                'AgentA/1.0',
                'https://shared.example/',
                FIRST,
                { authorization: 'Bearer synthetic-a' },
                undefined,
                TILE_A
            );
            configureRequestHeaderOverride(
                undefined,
                undefined,
                SECOND,
                undefined,
                undefined,
                TILE_B
            );

            expect(headersFor(SECOND)).toEqual({});
            // A request no owner can be identified by keeps the owner with
            // headers (D4).
            expect(
                headersFor('https://shared.example/live/segment-9.ts')
            ).toMatchObject({ 'User-Agent': 'AgentA/1.0' });
        });

        it('lets the most recently configured owner win other requests', async () => {
            const { configureRequestHeaderOverride } = await loadService();
            configureRequestHeaderOverride(
                'AgentA/1.0',
                undefined,
                FIRST,
                undefined,
                undefined,
                TILE_A
            );
            configureRequestHeaderOverride(
                'AgentB/1.0',
                undefined,
                SECOND,
                undefined,
                undefined,
                TILE_B
            );
            const segment = 'https://shared.example/live/segment-9.ts';
            expect(headersFor(segment)).toEqual({ 'User-Agent': 'AgentB/1.0' });

            // Reconfiguring an owner makes it the most recent one again.
            configureRequestHeaderOverride(
                'AgentA/2.0',
                undefined,
                FIRST,
                undefined,
                undefined,
                TILE_A
            );
            expect(headersFor(segment)).toEqual({ 'User-Agent': 'AgentA/2.0' });
        });
    });

    it('rejects control characters for a named owner as well', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        configureRequestHeaderOverride(
            'Agent\r\nX-Injected: 1',
            undefined,
            STREAM_A,
            { cookie: 'session=a\nEvil: 1' },
            undefined,
            TILE_A
        );

        expect(mockOnBeforeSendHeaders).not.toHaveBeenCalled();
    });

    it('forgets a released owner and keeps a header-free one claiming its stream', async () => {
        const { configureRequestHeaderOverride, releaseRequestHeaderOwner } =
            await loadService();
        const FIRST = 'https://shared.example/live/first.ts';
        const SECOND = 'https://shared.example/live/second.ts';
        configureRequestHeaderOverride(
            'AgentA/1.0',
            undefined,
            FIRST,
            undefined,
            undefined,
            TILE_A
        );
        configureRequestHeaderOverride(
            undefined,
            undefined,
            SECOND,
            undefined,
            undefined,
            TILE_B
        );
        expect(headersFor(SECOND)).toEqual({});

        releaseRequestHeaderOwner(TILE_B);

        expect(headersFor(SECOND)).toEqual({ 'User-Agent': 'AgentA/1.0' });
    });

    it('keeps playlist-wide headers off a tile of another source', async () => {
        const { configureRequestHeaderOverride } = await loadService();
        // A playlist-wide override (no scope), as the M3U player sets it.
        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            'https://list.example/'
        );
        configureRequestHeaderOverride(
            undefined,
            undefined,
            STREAM_B,
            undefined,
            undefined,
            TILE_B
        );

        expect(headersFor(STREAM_B)).toEqual({});
        expect(headersFor('https://elsewhere.example/x.ts')).toMatchObject({
            'User-Agent': 'PlaylistAgent/1.0',
        });
    });
});

// Module scope: the sibling spec declares the same helper names globally.
export {};
