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
                    rawWith(
                        '#KODIPROP:inputstream.adaptive.manifest_type=mpd'
                    )
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
