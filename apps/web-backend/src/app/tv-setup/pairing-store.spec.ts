import { PairingStore } from './pairing-store';
const source = {
    name: 'My source',
    provider: 'xtream',
    url: 'http://provider.example/',
    username: 'user',
    password: 'pass',
};
let clock = 100;
let store: PairingStore;
beforeEach(() => {
    clock = 100;
    store = new PairingStore(5000, () => clock);
});
afterEach(() => store.dispose());
it('isolates phone and TV capabilities and withholds secrets from phone status', () => {
    const a = store.create('a');
    const b = store.create('b');
    expect(() => store.read(a.id, a.phoneToken, 'tv')).toThrow('not valid');
    expect(() => store.read(a.id, b.tvToken, 'tv')).toThrow('not valid');
    expect(() => store.submit(a.id, a.tvToken, source)).toThrow('not valid');
    store.submit(a.id, a.phoneToken, source);
    expect(store.read(a.id, a.phoneToken, 'phone')).toEqual({
        status: 'pending',
        purpose: 'source',
        expiresAt: 5100,
    });
    expect(store.read(a.id, a.tvToken, 'tv').source).toMatchObject(source);
    expect(store.read(b.id, b.tvToken, 'tv').status).toBe('waiting');
});
it('is single-use, confirms only after TV acknowledgment, clears payload, and retries acknowledgment idempotently', () => {
    const a = store.create('a');
    expect(() => store.finish(a.id, a.tvToken, 'saved')).toThrow();
    store.submit(a.id, a.phoneToken, source);
    expect(() => store.submit(a.id, a.phoneToken, source)).toThrow(
        'already been used'
    );
    expect(store.read(a.id, a.phoneToken, 'phone').status).toBe('pending');
    store.finish(a.id, a.tvToken, 'saved');
    store.finish(a.id, a.tvToken, 'saved');
    expect(store.read(a.id, a.tvToken, 'tv').source).toBeUndefined();
    expect(store.read(a.id, a.phoneToken, 'phone').status).toBe('saved');
    expect(() => store.finish(a.id, a.tvToken, 'cancelled')).toThrow();
});
it('expires capabilities and payload, supports rejection and cancellation, and bounds new sessions', () => {
    const a = store.create('a');
    store.submit(a.id, a.phoneToken, source);
    clock = 5101;
    expect(() => store.read(a.id, a.tvToken, 'tv')).toThrow('expired');
    const b = store.create('a');
    store.submit(b.id, b.phoneToken, source);
    store.finish(b.id, b.tvToken, 'rejected');
    expect(store.read(b.id, b.tvToken, 'tv').source).toBeUndefined();
    const c = store.create('c');
    store.finish(c.id, c.tvToken, 'cancelled');
    expect(() => store.submit(c.id, c.phoneToken, source)).toThrow();
    for (let i = 0; i < 4; i++) store.create('a');
    expect(() => store.create('a')).toThrow('Too many');
});
it('rejects malformed values and strips caller IDs, auth state and unexpected fields', () => {
    const a = store.create('a');
    expect(() =>
        store.submit(a.id, a.phoneToken, {
            ...source,
            url: 'javascript:alert(1)',
        })
    ).toThrow();
    expect(() =>
        store.submit(a.id, a.phoneToken, { ...source, name: 123 })
    ).toThrow();
    expect(() =>
        store.submit(a.id, a.phoneToken, { ...source, password: '' })
    ).toThrow();
    store.submit(a.id, a.phoneToken, {
        ...source,
        id: 'overwrite',
        token: 'secret',
        endpoint: 'http://other',
        extra: 'bad',
    });
    expect(Object.keys(store.read(a.id, a.tvToken, 'tv').source!)).toEqual([
        'name',
        'provider',
        'url',
        'username',
        'password',
    ]);
});
it('retains full Stalker identity and passwords while canonicalizing a newly entered MAC', () => {
    const a = store.create('a');
    store.submit(a.id, a.phoneToken, {
        name: 'MAG',
        provider: 'stalker',
        url: 'http://provider.example/c/',
        macAddress: '00-1a-79-00-00-01',
        password: ' secret ',
        deviceId1: ' device ',
        signature2: 'sig',
    });
    expect(store.read(a.id, a.tvToken, 'tv').source).toMatchObject({
        macAddress: '00:1A:79:00:00:01',
        password: ' secret ',
        deviceId1: ' device ',
        signature2: 'sig',
    });
});

it('binds settings to a separate purpose and reveals replacement keys only to the TV', () => {
    const store = new PairingStore();
    const defaults = {
        layout: 'cinema' as const,
        epg: true,
        tmdb: { enabled: false, language: 'en', hasKey: true },
    };
    const session = store.create('settings', 'settings', defaults);
    expect(store.read(session.id, session.phoneToken, 'phone')).toMatchObject({
        purpose: 'settings',
        defaults,
    });
    expect(() =>
        store.submit(session.id, session.phoneToken, {
            provider: 'm3u',
            name: 'Unexpected',
            url: 'https://example.com/a.m3u',
        })
    ).toThrow();
    store.submit(session.id, session.phoneToken, {
        layout: 'shelf',
        epg: false,
        tmdb: { enabled: true, language: 'ru', apiKey: 'replacement-secret' },
    });
    expect(
        JSON.stringify(store.read(session.id, session.phoneToken, 'phone'))
    ).not.toContain('replacement-secret');
    expect(store.read(session.id, session.tvToken, 'tv')).toMatchObject({
        settings: { tmdb: { apiKey: 'replacement-secret' } },
    });
    store.finish(session.id, session.tvToken, 'saved');
    expect(store.read(session.id, session.tvToken, 'tv')).not.toHaveProperty(
        'settings'
    );
    store.dispose();
});
