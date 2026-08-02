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

function createRequestDetails(
    url: string,
    requestHeaders: Record<string, string> = {}
): Electron.OnBeforeSendHeadersListenerDetails {
    return {
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
    } as Electron.OnBeforeSendHeadersListenerDetails;
}

function runHeaderListener(
    listener: HeaderListener,
    url: string,
    requestHeaders: Record<string, string> = {}
): Record<string, string> {
    let response: Electron.BeforeSendResponse | undefined;

    listener(createRequestDetails(url, requestHeaders), (nextResponse) => {
        response = nextResponse;
    });

    if (!response?.requestHeaders) {
        throw new Error('Expected request headers response');
    }

    return response.requestHeaders as Record<string, string>;
}

describe('request header overrides', () => {
    beforeEach(() => {
        jest.resetModules();
        mockOnBeforeSendHeaders.mockClear();
    });

    it('registers one listener and updates the active scoped headers', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'FirstAgent/1.0',
            'https://portal.example/',
            'https://stream.example/live.m3u8'
        );
        configureRequestHeaderOverride(
            'SecondAgent/2.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );

        expect(mockOnBeforeSendHeaders).toHaveBeenCalledTimes(1);
        expect(mockOnBeforeSendHeaders).toHaveBeenCalledWith(
            { urls: ['http://*/*', 'https://*/*'] },
            expect.any(Function)
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://stream.example/segment.ts'
        );

        expect(headers).toEqual({
            Origin: 'https://portal.example',
            Referer: 'https://portal.example/referrer',
            'User-Agent': 'SecondAgent/2.0',
        });
    });

    it('does not apply scoped headers to unrelated origins', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'ScopedAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://unrelated.example/segment.ts',
            { Accept: '*/*' }
        );

        expect(headers).toEqual({ Accept: '*/*' });
    });

    it('applies playlist-level headers broadly when no stream scope is provided', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            'https://portal.example/referrer'
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://cdn.example/segment.ts'
        );

        expect(headers).toEqual({
            Origin: 'https://portal.example',
            Referer: 'https://portal.example/referrer',
            'User-Agent': 'PlaylistAgent/1.0',
        });
    });

    it('applies playlist-level user agents broadly without a referrer', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride('PlaylistAgent/1.0');

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://cdn.example/segment.ts'
        );

        expect(headers).toEqual({
            'User-Agent': 'PlaylistAgent/1.0',
        });
    });

    it('keeps playlist headers when a channel without headers clears scoped overrides', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            'https://portal.example/referrer'
        );
        configureRequestHeaderOverride(
            'ChannelAgent/2.0',
            'https://channel.example/referrer',
            'https://stream.example/live.m3u8'
        );
        configureRequestHeaderOverride(
            null,
            null,
            'https://stream.example/next.m3u8'
        );

        expect(mockOnBeforeSendHeaders).toHaveBeenCalledTimes(1);

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://stream.example/segment.ts'
        );

        expect(headers).toEqual({
            Origin: 'https://portal.example',
            Referer: 'https://portal.example/referrer',
            'User-Agent': 'PlaylistAgent/1.0',
        });
    });

    it('layers scoped channel headers over playlist defaults', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            'https://portal.example/referrer'
        );
        configureRequestHeaderOverride(
            'ChannelAgent/2.0',
            null,
            'https://stream.example/live.m3u8'
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://stream.example/segment.ts'
        );

        expect(headers).toEqual({
            Origin: 'https://portal.example',
            Referer: 'https://portal.example/referrer',
            'User-Agent': 'ChannelAgent/2.0',
        });
    });

    it('clears active header overrides without registering another listener', async () => {
        const { clearRequestHeaderOverride, configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            'https://portal.example/referrer'
        );
        configureRequestHeaderOverride(
            'ScopedAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );
        clearRequestHeaderOverride();

        expect(mockOnBeforeSendHeaders).toHaveBeenCalledTimes(1);

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://stream.example/segment.ts',
            { Accept: '*/*' }
        );

        expect(headers).toEqual({ Accept: '*/*' });
    });

    it('does not register a listener when cleared before any override exists', async () => {
        const { clearRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        clearRequestHeaderOverride();

        expect(mockOnBeforeSendHeaders).not.toHaveBeenCalled();
    });

    it('injects the YouTube embed Referer when none is present', async () => {
        const { registerStaticHeaderShims } = await import(
            './request-header-overrides.service'
        );

        registerStaticHeaderShims();
        expect(mockOnBeforeSendHeaders).toHaveBeenCalledTimes(1);

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://www.youtube-nocookie.com/embed/abc123'
        );

        expect(headers['Referer']).toBe('https://4gray.github.io/iptvnator/');
    });

    it('keeps an existing Referer on YouTube embed requests', async () => {
        const { registerStaticHeaderShims } = await import(
            './request-header-overrides.service'
        );

        registerStaticHeaderShims();
        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://www.youtube-nocookie.com/embed/abc123',
            { referer: 'http://localhost:4200/' }
        );

        expect(headers['referer']).toBe('http://localhost:4200/');
        expect(headers['Referer']).toBeUndefined();
    });

    it('does not inject the Referer for non-embed YouTube paths', async () => {
        const { registerStaticHeaderShims } = await import(
            './request-header-overrides.service'
        );

        registerStaticHeaderShims();
        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://www.youtube.com/watch?v=abc123'
        );

        expect(headers['Referer']).toBeUndefined();
    });

    it('does not inject the embed Referer for non-YouTube hosts', async () => {
        const { registerStaticHeaderShims } = await import(
            './request-header-overrides.service'
        );

        registerStaticHeaderShims();
        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://stream.example/segment.ts'
        );

        expect(headers['Referer']).toBeUndefined();
    });

    it('replaces existing header names case-insensitively', async () => {
        const { configureRequestHeaderOverride } =
            await import('./request-header-overrides.service');

        configureRequestHeaderOverride(
            'ScopedAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/live.m3u8'
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'https://stream.example/segment.ts',
            {
                origin: 'https://old.example',
                referer: 'https://old.example/ref',
                'user-agent': 'OldAgent/0.1',
            }
        );

        expect(headers).toEqual({
            Origin: 'https://portal.example',
            Referer: 'https://portal.example/referrer',
            'User-Agent': 'ScopedAgent/1.0',
        });
    });
});

/**
 * Portal credentials (Cookie/Authorization) in the scoped override — the
 * mechanism that lets built-in players play auth-gated portal streams. The
 * security contract pinned here: credentials apply ONLY to the exact stream
 * origin, never ride on the broader UA/Referer scope, never enter the
 * unscoped (playlist-level) layer, and are dropped when the scoped override
 * is cleared or replaced.
 */
describe('request header override credentials', () => {
    const STREAM_URL = 'http://portal.example:8080/live/ch1.ts';
    const SEGMENT_URL = 'http://portal.example:8080/live/segment-1.ts';
    const CREDENTIALS = {
        authorization: 'Bearer TOKEN123',
        cookie: 'mac=00%3A1A%3A79%3A00%3A00%3A01; stb_lang=en_US',
    };

    beforeEach(() => {
        jest.resetModules();
        mockOnBeforeSendHeaders.mockClear();
    });

    it('attaches cookie and authorization to requests on the stream origin', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            CREDENTIALS
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL);

        expect(headers['Cookie']).toBe(CREDENTIALS.cookie);
        expect(headers['Authorization']).toBe(CREDENTIALS.authorization);
        expect(headers['User-Agent']).toBe('MAG250');
        expect(headers['Referer']).toBe('http://portal.example');
    });

    it('does not attach credentials to the referer origin', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        // The UA/Referer scope includes the referer origin (port 80), but
        // the credentials belong to the stream origin (:8080) only.
        configureRequestHeaderOverride(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            CREDENTIALS
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'http://portal.example/some/page'
        );

        expect(headers['User-Agent']).toBe('MAG250');
        expect(headers['Cookie']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
    });

    it('never attaches credentials to a third-party host', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            CREDENTIALS
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(
            listener,
            'http://cdn.other-host.example/seg.ts',
            { Accept: '*/*' }
        );

        expect(headers).toEqual({ Accept: '*/*' });
    });

    it('ignores credentials passed without a scope URL', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            'PlaylistAgent/1.0',
            undefined,
            undefined,
            CREDENTIALS
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL);

        expect(headers['User-Agent']).toBe('PlaylistAgent/1.0');
        expect(headers['Cookie']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
    });

    it('drops credentials when the next stream replaces the scoped override', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            CREDENTIALS
        );
        configureRequestHeaderOverride(
            'OtherAgent/1.0',
            'http://other.example',
            'http://other.example/stream.m3u8'
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL);

        expect(headers['Cookie']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
    });

    it('clears the credentialed override when playback ends', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            CREDENTIALS
        );
        // The renderer's playback-end clear: empty values with a scope URL.
        configureRequestHeaderOverride(undefined, undefined, STREAM_URL);

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL, {
            Accept: '*/*',
        });

        expect(headers).toEqual({ Accept: '*/*' });
    });

    it('keeps a credentials-only override active without UA or referer', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            undefined,
            undefined,
            STREAM_URL,
            CREDENTIALS
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL);

        expect(headers['Cookie']).toBe(CREDENTIALS.cookie);
        expect(headers['Authorization']).toBe(CREDENTIALS.authorization);
    });

    it('replaces existing credential headers case-insensitively', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride(
            'MAG250',
            'http://portal.example',
            STREAM_URL,
            CREDENTIALS
        );

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL, {
            authorization: 'Bearer STALE',
            cookie: 'stale=1',
        });

        expect(headers['Cookie']).toBe(CREDENTIALS.cookie);
        expect(headers['cookie']).toBeUndefined();
        expect(headers['Authorization']).toBe(CREDENTIALS.authorization);
        expect(headers['authorization']).toBeUndefined();
    });

    it('rejects credential values containing control characters', async () => {
        const { configureRequestHeaderOverride } = await import(
            './request-header-overrides.service'
        );

        configureRequestHeaderOverride('MAG250', undefined, STREAM_URL, {
            authorization: 'Bearer TOKEN\r\nX-Injected: 1',
            cookie: 'mac=00\r\nX-Injected: 1',
        });

        const listener = mockOnBeforeSendHeaders.mock.calls[0][1];
        const headers = runHeaderListener(listener, SEGMENT_URL);

        expect(headers['Cookie']).toBeUndefined();
        expect(headers['Authorization']).toBeUndefined();
        expect(headers['X-Injected']).toBeUndefined();
    });
});
