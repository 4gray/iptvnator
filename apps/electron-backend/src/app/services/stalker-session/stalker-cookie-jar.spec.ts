import { StalkerCookieJar } from './stalker-cookie-jar';

describe('StalkerCookieJar', () => {
    const managedCookies = {
        mac: '00:1A:79:00:00:01',
        stb_lang: 'en',
        timezone: 'Europe/Berlin',
    };

    it('applies RFC domain, path, secure, HttpOnly, and duplicate-name rules', async () => {
        const jar = new StalkerCookieJar();

        await jar.collectResponseCookies('https://portal.example.com/c/', [
            'session=root; Domain=example.com; Path=/; HttpOnly',
            'session=portal; Path=/c; Secure',
            'plain=available; Path=/',
            'secure=only-https; Path=/; Secure',
        ]);

        expect(
            await jar.getCookieHeader('https://portal.example.com/c/page')
        ).toBe(
            'session=portal; session=root; plain=available; secure=only-https'
        );
        expect(
            await jar.getCookieHeader('http://portal.example.com/c/page')
        ).toBe('session=root; plain=available');
        expect(
            await jar.getCookieHeader('https://other.example.com/c/page')
        ).toBe('session=root');
    });

    it('uses the response-hop URL for redirect cookie mutations', async () => {
        const jar = new StalkerCookieJar();

        await jar.collectResponseCookies('https://one.example.test/start', [
            'first=one; Path=/',
        ]);
        await jar.collectResponseCookies('https://two.example.test/landing', [
            'second=two; Path=/',
        ]);

        expect(
            await jar.getCookieHeader('https://one.example.test/next')
        ).toBe('first=one');
        expect(
            await jar.getCookieHeader('https://two.example.test/next')
        ).toBe('second=two');
    });

    it('honors expiry against an injected clock', async () => {
        let now = new Date('2026-07-27T10:00:00.000Z');
        const jar = new StalkerCookieJar({}, { now: () => now });

        await jar.collectResponseCookies('https://portal.example.com/', [
            'short=lived; Max-Age=60; Path=/',
            'absolute=alive; Expires=Mon, 27 Jul 2026 10:02:00 GMT; Path=/',
        ]);

        now = new Date('2026-07-27T10:01:01.000Z');
        expect(
            await jar.getCookieHeader('https://portal.example.com/')
        ).toBe('absolute=alive');

        now = new Date('2026-07-27T10:02:01.000Z');
        expect(
            await jar.getCookieHeader('https://portal.example.com/')
        ).toBeUndefined();
    });

    it('rejects public-suffix cookies without retaining them', async () => {
        const jar = new StalkerCookieJar();

        await jar.collectResponseCookies('https://portal.example.com/', [
            'bad=value; Domain=com; Path=/',
            'good=value; Path=/',
        ]);

        expect(
            await jar.getCookieHeader('https://portal.example.com/')
        ).toBe('good=value');
    });

    it.each([
        'mac=server; Path=/',
        'MAC=server; Domain=example.com; Path=/c',
        'stb_lang=server; Path=/',
        'StB_LaNg=server; Domain=example.com; Path=/c',
        'timezone=server; Path=/',
        'TIMEZONE=server; Domain=example.com; Path=/c',
    ])(
        'discards every managed-cookie shadow attempt: %s',
        async (setCookie) => {
            const jar = new StalkerCookieJar(managedCookies);

            await jar.collectResponseCookies(
                'https://portal.example.com/c/',
                [setCookie, 'server=retained; Path=/']
            );

            expect(
                await jar.getCookieHeader(
                    'https://portal.example.com/c/request'
                )
            ).toBe(
                'server=retained; mac=00:1A:79:00:00:01; stb_lang=en; timezone=Europe/Berlin'
            );
        }
    );

    it('filters managed names again at request materialization', async () => {
        const jar = new StalkerCookieJar(managedCookies);

        await jar.collectResponseCookies('https://portal.example.com/', [
            'session=server; Path=/',
        ]);

        const internalJar = Reflect.get(jar, '__testJar');
        expect(internalJar).toBeUndefined();
        expect(
            await jar.getCookieHeader('https://portal.example.com/')
        ).toBe(
            'session=server; mac=00:1A:79:00:00:01; stb_lang=en; timezone=Europe/Berlin'
        );
    });

    it('clones cookie state without sharing later mutations', async () => {
        const original = new StalkerCookieJar(managedCookies);
        await original.collectResponseCookies(
            'https://portal.example.com/',
            ['landing=kept; Path=/']
        );

        const candidate = await original.clone();
        await candidate.collectResponseCookies(
            'https://portal.example.com/',
            ['candidate=isolated; Path=/']
        );

        expect(
            await original.getCookieHeader('https://portal.example.com/')
        ).toBe(
            'landing=kept; mac=00:1A:79:00:00:01; stb_lang=en; timezone=Europe/Berlin'
        );
        expect(
            await candidate.getCookieHeader('https://portal.example.com/')
        ).toBe(
            'landing=kept; candidate=isolated; mac=00:1A:79:00:00:01; stb_lang=en; timezone=Europe/Berlin'
        );
    });

    it('does not expose a serialization surface or enumerable cookie state', () => {
        const jar = new StalkerCookieJar(managedCookies);

        expect('serialize' in jar).toBe(false);
        expect('toJSON' in jar).toBe(false);
        expect(JSON.stringify(jar)).toBe('{}');
        expect(Object.keys(jar)).toEqual([]);
    });

    it('rejects unsafe managed-cookie values', () => {
        expect(
            () =>
                new StalkerCookieJar({
                    ...managedCookies,
                    timezone: 'UTC; injected=value',
                })
        ).toThrow('invalid-identity-input');
    });
});
