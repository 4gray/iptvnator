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
