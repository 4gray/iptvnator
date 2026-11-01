import {
    TmdbMatchService,
    tmdbMatchKey,
    type TmdbMatchIdentity,
} from './tmdb-match.service';

const identity: TmdbMatchIdentity = {
    provider: 'stalker',
    playlistId: 'portal-a',
    mediaType: 'tv',
    itemId: '42',
};
const choice = {
    mode: 'manual' as const,
    tmdbId: 900101,
    title: 'Синтетический сериал Альфа',
};

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

it('persists a choice across service recreation and scopes it by source, provider, type and item', async () => {
    const matches = new TmdbMatchService();
    await matches.save(identity, choice);
    expect(new TmdbMatchService().read(identity)).toEqual(choice);
    for (const other of [
        { ...identity, playlistId: 'portal-b' },
        { ...identity, provider: 'xtream' as const },
        { ...identity, mediaType: 'movie' as const },
        { ...identity, itemId: '43' },
        { ...identity, catalog: 'series' as const },
    ])
        expect(matches.read(other)).toBeNull();
});

it('retains existing VOD choice keys when the catalog is explicit', async () => {
    const matches = new TmdbMatchService();
    await matches.save(identity, choice);
    expect(matches.read({ ...identity, catalog: 'vod' })).toEqual(choice);
});

it('persists provider-only and removes only this choice when automatic matching is restored', async () => {
    const matches = new TmdbMatchService();
    const other = { ...identity, itemId: '43' };
    await matches.save(other, choice);
    await matches.save(identity, { mode: 'provider' });
    expect(new TmdbMatchService().read(identity)).toEqual({ mode: 'provider' });
    await matches.save(identity, null);
    expect(localStorage.getItem(tmdbMatchKey(identity))).toBeNull();
    expect(matches.read(other)).toEqual(choice);
});

it('refreshes only current registrations for the changed identity after its choice commits', async () => {
    const matches = new TmdbMatchService();
    const owner = {};
    const retired = jest.fn();
    const other = jest.fn();
    const refresh = jest.fn(async () => {
        expect(matches.read(identity)).toEqual(choice);
    });
    matches.register(owner, identity, retired);
    matches.register(owner, identity, refresh);
    matches.register({}, { ...identity, itemId: '43' }, other);
    await matches.save(identity, choice);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(retired).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(matches.version(identity)).toBe(1);
});

it('does not update the visible selection or version when persistence fails', async () => {
    const matches = new TmdbMatchService();
    const refresh = jest.fn();
    matches.register({}, identity, refresh);
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full');
    });
    await expect(matches.save(identity, choice)).rejects.toThrow('full');
    expect(refresh).not.toHaveBeenCalled();
    expect(matches.version(identity)).toBe(0);
});

it.each([
    'bad json',
    '{}',
    '{"mode":"manual","tmdbId":-1,"title":"bad"}',
    '{"mode":"manual","tmdbId":"42","title":"bad"}',
])('ignores malformed stored choices: %s', (raw) => {
    localStorage.setItem(tmdbMatchKey(identity), raw);
    expect(new TmdbMatchService().read(identity)).toBeNull();
});
