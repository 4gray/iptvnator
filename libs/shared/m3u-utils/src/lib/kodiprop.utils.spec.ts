import { extractDrmFromRaw, isClearKeyLicenseType } from './kodiprop.utils';

const KID_HEX = '9eb4050de44b4802932e27d75083e266';
const KEY_HEX = '166634c675823c235a4a9446fad52e4d';
// base64url encodings of the same 16-byte values as above.
const KID_B64 = 'nrQFDeRLSAKTLifXUIPiZg';
const KEY_B64 = 'FmY0xnWCPCNaSpRG-tUuTQ';

const rawWith = (...kodipropLines: string[]): string =>
    [
        '#EXTINF:-1 tvg-id="enc" group-title="DASH",Encrypted channel',
        ...kodipropLines,
        'http://example.com/stream.mpd',
    ].join('\r\n');

describe('kodiprop.utils', () => {
    describe('extractDrmFromRaw', () => {
        it('parses a single hex kid:key ClearKey pair', () => {
            const drm = extractDrmFromRaw(
                rawWith(
                    '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                    `#KODIPROP:inputstream.adaptive.license_key=${KID_HEX}:${KEY_HEX}`
                )
            );

            expect(drm).toEqual({
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { [KID_HEX]: KEY_HEX },
            });
        });

        it('accepts the org.w3.clearkey license type and dashed UUID kids', () => {
            const dashedKid =
                '9eb4050d-e44b-4802-932e-27d75083e266'.toUpperCase();
            const drm = extractDrmFromRaw(
                rawWith(
                    '#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey',
                    `#KODIPROP:inputstream.adaptive.license_key=${dashedKid}:${KEY_HEX}`
                )
            );

            expect(drm?.supported).toBe(true);
            expect(drm?.clearKeys).toEqual({ [KID_HEX]: KEY_HEX });
        });

        it('parses comma-separated multi-key pairs', () => {
            const secondKid = 'a'.repeat(32);
            const secondKey = 'b'.repeat(32);
            const drm = extractDrmFromRaw(
                rawWith(
                    '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                    `#KODIPROP:inputstream.adaptive.license_key=${KID_HEX}:${KEY_HEX},${secondKid}:${secondKey}`
                )
            );

            expect(drm?.clearKeys).toEqual({
                [KID_HEX]: KEY_HEX,
                [secondKid]: secondKey,
            });
        });

        it('parses the W3C ClearKey license JSON with base64url values', () => {
            const license = JSON.stringify({
                keys: [{ kty: 'oct', k: KEY_B64, kid: KID_B64 }],
                type: 'temporary',
            });
            const drm = extractDrmFromRaw(
                rawWith(
                    '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                    `#KODIPROP:inputstream.adaptive.license_key=${license}`
                )
            );

            expect(drm).toEqual({
                licenseType: 'clearkey',
                supported: true,
                clearKeys: { [KID_HEX]: KEY_HEX },
            });
        });

        it('parses the plain JSON kid→key map form', () => {
            const drm = extractDrmFromRaw(
                rawWith(
                    '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                    `#KODIPROP:inputstream.adaptive.license_key={"${KID_HEX}":"${KEY_HEX}"}`
                )
            );

            expect(drm?.clearKeys).toEqual({ [KID_HEX]: KEY_HEX });
        });

        describe.each(['atob', 'Buffer'])('%s decoder', (decoder) => {
            const atobDescriptor = Object.getOwnPropertyDescriptor(
                globalThis,
                'atob'
            );

            beforeEach(() => {
                if (decoder === 'Buffer') {
                    Object.defineProperty(globalThis, 'atob', {
                        configurable: true,
                        value: undefined,
                    });
                }
            });

            afterEach(() => {
                if (atobDescriptor) {
                    Object.defineProperty(globalThis, 'atob', atobDescriptor);
                } else {
                    Reflect.deleteProperty(globalThis, 'atob');
                }
            });

            it.each([true, false])(
                'accepts standard Base64 JSON keys (padding=%s)',
                (padding) => {
                    // Synthetic bytes exercise both + and /, as in #1466.
                    const kidHex = 'fb'.repeat(16);
                    const keyHex = 'ff'.repeat(16);
                    const encode = (hex: string): string => {
                        const value = Buffer.from(hex, 'hex').toString(
                            'base64'
                        );
                        return padding ? value : value.replace(/=+$/, '');
                    };
                    const license = JSON.stringify({
                        keys: [
                            {
                                kty: 'oct',
                                kid: encode(kidHex),
                                k: encode(keyHex),
                            },
                        ],
                        type: 'temporary',
                    });

                    expect(
                        extractDrmFromRaw(
                            rawWith(
                                '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                                `#KODIPROP:inputstream.adaptive.license_key=${license}`
                            )
                        )
                    ).toEqual({
                        licenseType: 'clearkey',
                        supported: true,
                        clearKeys: { [kidHex]: keyHex },
                    });
                }
            );

            it.each([
                Buffer.alloc(15, 255).toString('base64'),
                Buffer.alloc(17, 255).toString('base64'),
                `${KEY_B64}!`,
                `${KEY_B64.slice(0, 10)} ${KEY_B64.slice(10)}`,
                `${KEY_B64}===`,
                `${KEY_B64.slice(0, 10)}=${KEY_B64.slice(10)}`,
                `${KID_HEX.slice(0, 16)} corrupted ${KID_HEX.slice(16)}`,
            ])('rejects invalid key components: %s', (invalid) => {
                for (const entry of [
                    { kid: invalid, k: KEY_B64 },
                    { kid: KID_B64, k: invalid },
                ]) {
                    expect(
                        extractDrmFromRaw(
                            rawWith(
                                '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                                `#KODIPROP:inputstream.adaptive.license_key=${JSON.stringify({ keys: [entry] })}`
                            )
                        )
                    ).toEqual({ licenseType: 'clearkey', supported: false });
                }
            });
        });

        it('parses the drm_legacy combined property', () => {
            const drm = extractDrmFromRaw(
                rawWith(
                    `#KODIPROP:inputstream.adaptive.drm_legacy=org.w3.clearkey|${KID_HEX}:${KEY_HEX}`
                )
            );

            expect(drm).toEqual({
                licenseType: 'org.w3.clearkey',
                supported: true,
                clearKeys: { [KID_HEX]: KEY_HEX },
            });
        });

        it('treats a parseable key without license type as ClearKey', () => {
            const drm = extractDrmFromRaw(
                rawWith(
                    `#KODIPROP:inputstream.adaptive.license_key=${KID_HEX}:${KEY_HEX}`
                )
            );

            expect(drm?.supported).toBe(true);
            expect(drm?.licenseType).toBe('clearkey');
        });

        it('marks widevine as unsupported without throwing', () => {
            const drm = extractDrmFromRaw(
                rawWith(
                    '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
                    '#KODIPROP:inputstream.adaptive.license_key=https://license.example.com/wv'
                )
            );

            expect(drm).toEqual({
                licenseType: 'com.widevine.alpha',
                supported: false,
            });
        });

        it.each([
            ['truncated hex pair', `${KID_HEX.slice(0, 10)}:${KEY_HEX}`],
            ['missing key part', KID_HEX],
            ['license server URL', 'https://license.example.com/ck'],
            ['broken JSON', '{"keys":[{'],
            ['JSON with non-string values', `{"${KID_HEX}": 42}`],
        ])(
            'marks ClearKey with a malformed key value as unsupported (%s)',
            (_label, licenseKey) => {
                const drm = extractDrmFromRaw(
                    rawWith(
                        '#KODIPROP:inputstream.adaptive.license_type=clearkey',
                        `#KODIPROP:inputstream.adaptive.license_key=${licenseKey}`
                    )
                );

                expect(drm).toEqual({
                    licenseType: 'clearkey',
                    supported: false,
                });
            }
        );

        it('returns undefined for channels without KODIPROP lines', () => {
            expect(
                extractDrmFromRaw(
                    '#EXTINF:-1 tvg-id="plain",Plain channel\r\nhttp://example.com/live.m3u8'
                )
            ).toBeUndefined();
        });

        it('ignores unrelated KODIPROP properties', () => {
            expect(
                extractDrmFromRaw(
                    rawWith('#KODIPROP:inputstream.adaptive.manifest_type=mpd')
                )
            ).toBeUndefined();
        });

        it('returns undefined for empty or missing raw', () => {
            expect(extractDrmFromRaw(undefined)).toBeUndefined();
            expect(extractDrmFromRaw('')).toBeUndefined();
        });
    });

    describe('isClearKeyLicenseType', () => {
        it.each(['clearkey', 'org.w3.clearkey', ' ClearKey '])(
            'accepts %s',
            (value) => {
                expect(isClearKeyLicenseType(value)).toBe(true);
            }
        );

        it.each(['com.widevine.alpha', 'com.microsoft.playready', ''])(
            'rejects %s',
            (value) => {
                expect(isClearKeyLicenseType(value)).toBe(false);
            }
        );
    });
});
