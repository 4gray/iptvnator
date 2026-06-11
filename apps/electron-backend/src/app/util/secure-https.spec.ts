import { createPlaylistHttpsAgent, isInsecureTlsAllowed } from './secure-https';

describe('secure-https', () => {
    const originalValue = process.env.IPTVNATOR_ALLOW_INSECURE_TLS;

    afterEach(() => {
        if (originalValue === undefined) {
            delete process.env.IPTVNATOR_ALLOW_INSECURE_TLS;
        } else {
            process.env.IPTVNATOR_ALLOW_INSECURE_TLS = originalValue;
        }
    });

    it('validates certificates by default', () => {
        delete process.env.IPTVNATOR_ALLOW_INSECURE_TLS;

        expect(isInsecureTlsAllowed()).toBe(false);
        expect(createPlaylistHttpsAgent().options.rejectUnauthorized).toBe(
            true
        );
    });

    it.each(['1', 'true', ' TRUE '])(
        'allows an explicit insecure TLS opt-in via %s',
        (value) => {
            process.env.IPTVNATOR_ALLOW_INSECURE_TLS = value;

            expect(isInsecureTlsAllowed()).toBe(true);
            expect(createPlaylistHttpsAgent().options.rejectUnauthorized).toBe(
                false
            );
        }
    );

    it('does not accept unrelated truthy values', () => {
        process.env.IPTVNATOR_ALLOW_INSECURE_TLS = 'yes';

        expect(isInsecureTlsAllowed()).toBe(false);
    });
});
