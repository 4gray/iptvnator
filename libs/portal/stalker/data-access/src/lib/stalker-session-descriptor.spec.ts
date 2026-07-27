import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    mapPlaylistToStalkerSessionConnection,
    type StalkerSessionDescriptorMappingOptions,
} from './stalker-session-descriptor';

function playlist(overrides: Partial<Playlist> = {}): Playlist {
    return {
        _id: 'playlist-1',
        autoRefresh: false,
        count: 0,
        importDate: '2026-07-27T00:00:00.000Z',
        lastUsage: '2026-07-27T00:00:00.000Z',
        macAddress: '00-1a-79-aa-bb-cc',
        portalUrl: 'https://portal.example/stalker_portal/server/load.php',
        title: 'Portal',
        ...overrides,
    };
}

describe('mapPlaylistToStalkerSessionConnection', () => {
    it('prefers stalkerSourceUrl, then portalUrl, then the legacy url', () => {
        expect(
            mapPlaylistToStalkerSessionConnection(
                playlist({
                    stalkerSourceUrl: 'https://source.example/c/',
                    portalUrl: 'https://endpoint.example/portal.php',
                    url: 'https://legacy.example/c/',
                })
            ).descriptor.sourceUrl
        ).toBe('https://source.example/c/');

        expect(
            mapPlaylistToStalkerSessionConnection(
                playlist({
                    stalkerSourceUrl: undefined,
                    portalUrl: 'https://endpoint.example/portal.php',
                    url: 'https://legacy.example/c/',
                })
            ).descriptor.sourceUrl
        ).toBe('https://endpoint.example/portal.php');

        expect(
            mapPlaylistToStalkerSessionConnection(
                playlist({
                    stalkerSourceUrl: undefined,
                    portalUrl: undefined,
                    url: 'https://legacy.example/c/',
                })
            ).descriptor.sourceUrl
        ).toBe('https://legacy.example/c/');
    });

    it('maps a persisted playlist to normalized identity and learned endpoint hint', () => {
        const result = mapPlaylistToStalkerSessionConnection(
            playlist({
                portalUrl: 'https://portal.example/server/load.php',
                stalkerSourceUrl: 'https://portal.example/c/',
            })
        );

        expect(result).toEqual({
            descriptor: {
                connectionMode: 'persisted-open',
                learnedEndpointHint: 'https://portal.example/server/load.php',
                macAddress: '00:1A:79:AA:BB:CC',
                playlistRef: 'playlist-1',
                profilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
                sourceUrl: 'https://portal.example/c/',
            },
        });
    });

    it.each([
        {
            options: {
                connectionMode: 'provisional',
                provisionalReason: 'import',
            } satisfies StalkerSessionDescriptorMappingOptions,
            reason: 'import',
        },
        {
            options: {
                connectionMode: 'provisional',
                provisionalReason: 'edit',
            } satisfies StalkerSessionDescriptorMappingOptions,
            reason: 'edit',
        },
        {
            options: {
                connectionMode: 'provisional',
                provisionalReason: 'migration',
            } satisfies StalkerSessionDescriptorMappingOptions,
            reason: 'migration',
        },
    ])('maps a provisional $reason attempt', ({ options, reason }) => {
        expect(
            mapPlaylistToStalkerSessionConnection(playlist(), options)
                .descriptor
        ).toEqual(
            expect.objectContaining({
                connectionMode: 'provisional',
                provisionalReason: reason,
            })
        );
    });

    it('maps explicit profile, identity, and transport overrides unchanged', () => {
        const result = mapPlaylistToStalkerSessionConnection(
            playlist({
                stalkerIdentityOverrides: {
                    apiSignature: 'API-SIGNATURE',
                    deviceId1: 'DEVICE-1',
                    firmwareVersion: 'FIRMWARE-TUPLE',
                    serialNumber: 'SERIAL-1',
                },
                stalkerProfilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 1,
                },
                stalkerTransportConfiguration: {
                    language: 'de',
                    locale: 'de-DE',
                    origin: 'https://portal.example',
                    referer: 'https://portal.example/c/',
                    timezone: 'Europe/Berlin',
                    userAgent: 'Explicit User Agent',
                    xUserAgent: 'Explicit X User Agent',
                },
            })
        );

        expect(result.descriptor.identityOverrides).toEqual({
            apiSignature: 'API-SIGNATURE',
            deviceId1: 'DEVICE-1',
            firmwareVersion: 'FIRMWARE-TUPLE',
            serialNumber: 'SERIAL-1',
        });
        expect(result.descriptor.transportConfiguration).toEqual({
            language: 'de',
            locale: 'de-DE',
            origin: 'https://portal.example',
            referer: 'https://portal.example/c/',
            timezone: 'Europe/Berlin',
            userAgent: 'Explicit User Agent',
            xUserAgent: 'Explicit X User Agent',
        });
    });

    it('maps legacy identity and transport fields while omitting blanks and the synthetic default serial', () => {
        const result = mapPlaylistToStalkerSessionConnection(
            playlist({
                origin: 'https://portal.example',
                referrer: 'https://portal.example/c/',
                stalkerDeviceId1: ' DEVICE-1 ',
                stalkerDeviceId2: '',
                stalkerSerialNumber: 'BEDACD4569BAF',
                stalkerSignature1: 'SIGNATURE-1',
                stalkerSignature2: '   ',
                userAgent: 'Explicit User Agent',
            })
        );

        expect(result.descriptor.identityOverrides).toEqual({
            deviceId1: ' DEVICE-1 ',
            signature1: 'SIGNATURE-1',
        });
        expect(result.descriptor.transportConfiguration).toEqual({
            origin: 'https://portal.example',
            referer: 'https://portal.example/c/',
            userAgent: 'Explicit User Agent',
        });
    });

    it('returns saved credentials separately without placing them in the descriptor', () => {
        const result = mapPlaylistToStalkerSessionConnection(
            playlist({
                password: 'password-secret',
                username: ' exact user ',
            })
        );

        expect(result.savedCredentials).toEqual({
            password: 'password-secret',
            username: ' exact user ',
        });
        expect(JSON.stringify(result.descriptor)).not.toContain(
            'password-secret'
        );
        expect(result.descriptor).not.toHaveProperty('credentials');
    });

    it('does not auto-submit a legacy username when its password is missing or empty', () => {
        expect(
            mapPlaylistToStalkerSessionConnection(
                playlist({
                    password: undefined,
                    username: ' exact user ',
                })
            ).savedCredentials
        ).toBeUndefined();
        expect(
            mapPlaylistToStalkerSessionConnection(
                playlist({
                    password: '',
                    username: ' exact user ',
                })
            ).savedCredentials
        ).toBeUndefined();
    });

    it('never reads the legacy stalkerToken into the new mapping', () => {
        const result = mapPlaylistToStalkerSessionConnection(
            playlist({ stalkerToken: 'legacy-token-secret' })
        );

        expect(JSON.stringify(result)).not.toContain('legacy-token-secret');
    });

    it.each([
        playlist({
            stalkerSourceUrl: undefined,
            portalUrl: undefined,
            url: '',
        }),
        playlist({ macAddress: undefined }),
        playlist({ _id: '' }),
    ])('rejects an incomplete playlist mapping', (invalidPlaylist) => {
        expect(() =>
            mapPlaylistToStalkerSessionConnection(invalidPlaylist)
        ).toThrow('invalid-identity-input');
    });
});
