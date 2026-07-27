import { LEGACY_DEFAULT_STALKER_SERIAL } from '@iptvnator/shared/interfaces';
import {
    getStalkerPlaybackContextHeaders,
    rememberStalkerPlaybackContext,
    StalkerPlaybackContextService,
} from './stalker-playback-context.service';

describe('stalker playback context', () => {
    const macAddress = '00:1A:79:AA:BB:CC';

    function rememberSameOriginContext(
        name: string,
        serialNumber?: string
    ): Record<string, string> {
        const origin = `http://${name}.example.test`;
        const streamUrl = `${origin}/stream/1.ts`;

        rememberStalkerPlaybackContext({
            streamUrl,
            portalUrl: `${origin}/stalker_portal/server/load.php`,
            macAddress,
            serialNumber,
            token: 'token-1',
        });

        return getStalkerPlaybackContextHeaders(streamUrl) ?? {};
    }

    it('does not add SN or a serial-derived __cfduid when serial is absent', () => {
        const headers = rememberSameOriginContext('stalker-no-serial');

        expect(headers).not.toHaveProperty('SN');
        expect(headers['Cookie']).not.toContain('__cfduid=');
    });

    it('preserves a provided serial and creates a canonical __cfduid', () => {
        const headers = rememberSameOriginContext(
            'stalker-with-serial',
            ' CustomSn123 '
        );
        const cfduid = headers['Cookie']?.match(/__cfduid=([^;]+)/)?.[1];

        expect(headers['SN']).toBe('CustomSn123');
        expect(cfduid).toHaveLength(32);
    });

    it('treats the legacy default serial as absent', () => {
        const headers = rememberSameOriginContext(
            'stalker-legacy-serial',
            LEGACY_DEFAULT_STALKER_SERIAL
        );

        expect(headers).not.toHaveProperty('SN');
        expect(headers['Cookie']).not.toContain('__cfduid=');
    });

    it('does not reuse a legacy context for another query or origin path', () => {
        const origin = 'http://legacy-context.example.test';
        rememberStalkerPlaybackContext({
            streamUrl: `${origin}/stream/1.ts?ticket=one`,
            portalUrl: `${origin}/stalker_portal/server/load.php`,
            macAddress,
            token: 'token-1',
        });

        expect(
            getStalkerPlaybackContextHeaders(`${origin}/stream/1.ts?ticket=two`)
        ).toBeNull();
        expect(
            getStalkerPlaybackContextHeaders(`${origin}/another.ts`)
        ).toBeNull();
    });
});

describe('opaque Stalker playback contexts', () => {
    let now: number;
    let nextRef: number;
    let service: StalkerPlaybackContextService;

    beforeEach(() => {
        now = 1_000;
        nextRef = 0;
        service = new StalkerPlaybackContextService({
            createRef: () => `opaque-ref-${++nextRef}`,
            now: () => now,
        });
    });

    function register(
        overrides: Partial<
            Parameters<StalkerPlaybackContextService['register']>[0]
        > = {}
    ): string {
        return service.register({
            authGeneration: 4,
            coordinatorEpoch: 7,
            headers: {
                Authorization: 'Bearer synthetic-token',
                Cookie: 'mac=02:00:00:00:00:01; session=synthetic',
            },
            leaseRef: 'lease-a',
            senderId: 10,
            sessionKey: 'session-a',
            streamUrl: 'https://media.example.test/live.ts?ticket=one#ignored',
            ...overrides,
        });
    }

    it('binds a single-use context to sender and exact normalized stream URL', () => {
        const contextRef = register();

        expect(
            service.consume({
                contextRef,
                senderId: 11,
                streamUrl: 'https://media.example.test/live.ts?ticket=one',
            })
        ).toBeNull();
        expect(
            service.consume({
                contextRef,
                senderId: 10,
                streamUrl: 'https://media.example.test/live.ts?ticket=other',
            })
        ).toBeNull();

        expect(
            service.consume({
                contextRef,
                senderId: 10,
                streamUrl: 'https://media.example.test/live.ts?ticket=one',
            })
        ).toEqual({
            Authorization: 'Bearer synthetic-token',
            Cookie: 'mac=02:00:00:00:00:01; session=synthetic',
        });
        expect(
            service.consume({
                contextRef,
                senderId: 10,
                streamUrl: 'https://media.example.test/live.ts?ticket=one',
            })
        ).toBeNull();
    });

    it('expires contexts after exactly two minutes', () => {
        const contextRef = register();
        now += 120_000;

        expect(
            service.consume({
                contextRef,
                senderId: 10,
                streamUrl: 'https://media.example.test/live.ts?ticket=one',
            })
        ).toBeNull();
        expect(service.size).toBe(0);
    });

    it('invalidates by lease, session, auth generation, coordinator epoch, and sender', () => {
        const leaseRef = register();
        service.invalidateLease('lease-a');
        expect(service.has(leaseRef)).toBe(false);

        const sessionRef = register({ leaseRef: 'lease-b' });
        service.invalidateSession('session-a');
        expect(service.has(sessionRef)).toBe(false);

        const generationRef = register({
            authGeneration: 5,
            sessionKey: 'session-b',
        });
        service.invalidateAuthGeneration('session-b', 5);
        expect(service.has(generationRef)).toBe(false);

        const epochRef = register({
            coordinatorEpoch: 8,
            sessionKey: 'session-c',
        });
        service.invalidateCoordinatorEpoch('session-c', 8);
        expect(service.has(epochRef)).toBe(false);

        const senderRef = register({ senderId: 12, sessionKey: 'session-d' });
        service.cleanupSender(12);
        expect(service.has(senderRef)).toBe(false);
    });

    it('invalidates an old generation without deleting the replacement generation', () => {
        const oldRef = register({
            authGeneration: 1,
            sessionKey: 'session-shared',
        });
        const newRef = register({
            authGeneration: 2,
            sessionKey: 'session-shared',
            streamUrl: 'https://media.example.test/new.ts',
        });

        service.invalidateAuthGeneration('session-shared', 1);

        expect(service.has(oldRef)).toBe(false);
        expect(service.has(newRef)).toBe(true);
    });

    it('copies headers into and out of the private registry', () => {
        const headers = { Authorization: 'Bearer original' };
        const contextRef = register({ headers });
        headers.Authorization = 'Bearer mutated';

        const resolved = service.consume({
            contextRef,
            senderId: 10,
            streamUrl: 'https://media.example.test/live.ts?ticket=one',
        });
        expect(resolved).toEqual({ Authorization: 'Bearer original' });
        if (resolved) {
            resolved.Authorization = 'Bearer returned-mutation';
        }
        expect(JSON.stringify({ contextRef })).not.toContain('original');
    });

    it('rejects invalid URLs, headers, refs, and binding metadata', () => {
        expect(() => register({ streamUrl: 'file:///tmp/video' })).toThrow(
            'invalid-playback-context'
        );
        expect(() =>
            register({ headers: { Cookie: 'session=one\r\nInjected: yes' } })
        ).toThrow('invalid-playback-context');
        expect(() => register({ authGeneration: -1 })).toThrow(
            'invalid-playback-context'
        );
        expect(() => register({ coordinatorEpoch: -1 })).toThrow(
            'invalid-playback-context'
        );
        expect(() => register({ senderId: -1 })).toThrow(
            'invalid-playback-context'
        );
        expect(() => register({ leaseRef: '' })).toThrow(
            'invalid-playback-context'
        );
    });
});
