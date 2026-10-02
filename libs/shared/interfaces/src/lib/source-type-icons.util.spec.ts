import {
    getPlaylistSourceIcon,
    resolvePlaylistSourceIconKey,
    SOURCE_TYPE_ICONS,
} from './source-type-icons.util';

describe('source type icons', () => {
    it('never lets one icon stand for two providers', () => {
        const byProvider = {
            xtream: [SOURCE_TYPE_ICONS.xtream],
            stalker: [SOURCE_TYPE_ICONS.stalker],
            m3u: [
                SOURCE_TYPE_ICONS.m3u,
                SOURCE_TYPE_ICONS['m3u-url'],
                SOURCE_TYPE_ICONS['m3u-local'],
                SOURCE_TYPE_ICONS['m3u-text'],
            ],
        };
        const owners = new Map<string, string>();
        for (const [provider, icons] of Object.entries(byProvider)) {
            for (const icon of icons) {
                expect(owners.get(icon) ?? provider).toBe(provider);
                owners.set(icon, provider);
            }
        }
    });

    it('does not reuse the Dashboard rail icon for a provider', () => {
        expect(Object.values(SOURCE_TYPE_ICONS)).not.toContain('dashboard');
    });

    it.each([
        [{ macAddress: '00:1A:79:00:00:01', url: 'http://portal' }, 'stalker'],
        [{ serverUrl: 'http://xtream' }, 'xtream'],
        [{ url: 'http://list.m3u' }, 'm3u-url'],
        [{}, 'm3u-local'],
    ] as const)('resolves %o to %s', (playlist, expected) => {
        expect(resolvePlaylistSourceIconKey(playlist)).toBe(expected);
        expect(getPlaylistSourceIcon(playlist)).toBe(
            SOURCE_TYPE_ICONS[expected]
        );
    });
});
