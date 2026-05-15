import {
    LEGACY_DEFAULT_STALKER_SERIAL,
    buildStalkerIdentityRequestContext,
} from './stalker-identity';

describe('buildStalkerIdentityRequestContext', () => {
    const macAddress = '00:1A:79:AA:BB:CC';

    it('does not add SN header or force get_profile SN fields when serial is absent', () => {
        const context = buildStalkerIdentityRequestContext({
            macAddress,
            params: {
                type: 'stb',
                action: 'get_profile',
                sn: 'STALE-SN',
                metrics: JSON.stringify({
                    mac: macAddress,
                    sn: 'STALE-SN',
                }),
            },
        });

        expect(context.effectiveSerialNumber).toBeUndefined();
        expect(context.headers).not.toHaveProperty('SN');
        expect(context.cookieString).not.toContain('__cfduid=');
        expect(context.requestParams).not.toHaveProperty('sn');
        expect(
            JSON.parse(String(context.requestParams.metrics))
        ).not.toHaveProperty('sn');
    });

    it('preserves a provided serial exactly in headers, params, and metrics', () => {
        const context = buildStalkerIdentityRequestContext({
            macAddress,
            serialNumber: 'CustomSn123',
            params: {
                type: 'stb',
                action: 'get_profile',
                metrics: JSON.stringify({
                    mac: macAddress,
                }),
            },
        });

        expect(context.effectiveSerialNumber).toBe('CustomSn123');
        expect(context.headers.SN).toBe('CustomSn123');
        expect(context.cookieString).toContain('__cfduid=');
        expect(
            context.cookieString.match(/__cfduid=([^;]+)/)?.[1]
        ).toHaveLength(32);
        expect(context.requestParams.sn).toBe('CustomSn123');
        expect(JSON.parse(String(context.requestParams.metrics))).toEqual(
            expect.objectContaining({
                sn: 'CustomSn123',
            })
        );
    });

    it('treats the legacy default serial as absent', () => {
        const context = buildStalkerIdentityRequestContext({
            macAddress,
            serialNumber: LEGACY_DEFAULT_STALKER_SERIAL,
            params: {
                type: 'stb',
                action: 'get_profile',
                sn: LEGACY_DEFAULT_STALKER_SERIAL,
                metrics: JSON.stringify({
                    mac: macAddress,
                    sn: LEGACY_DEFAULT_STALKER_SERIAL,
                }),
            },
        });

        expect(context.effectiveSerialNumber).toBeUndefined();
        expect(context.headers).not.toHaveProperty('SN');
        expect(context.cookieString).not.toContain('__cfduid=');
        expect(context.requestParams).not.toHaveProperty('sn');
        expect(
            JSON.parse(String(context.requestParams.metrics))
        ).not.toHaveProperty('sn');
    });

    it('removes stale SN params from non-profile requests', () => {
        const context = buildStalkerIdentityRequestContext({
            macAddress,
            params: {
                type: 'itv',
                action: 'get_ordered_list',
                sn: 'STALE-SN',
            },
        });

        expect(context.requestParams).not.toHaveProperty('sn');
    });
});
