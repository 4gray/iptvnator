import { SERVER_USER_STATE_NAMESPACES } from '@iptvnator/shared/interfaces';
import { createSourceProfileUserDataStorage } from './source-profile-user-data';

describe('source-profile activity migration', () => {
    afterEach(() => localStorage.clear());
    it('adopts every old instance namespace once without changing its original cache', () => {
        const profile = 'iptvnator-server:nas';
        for (const namespace of SERVER_USER_STATE_NAMESPACES)
            localStorage.setItem(
                `iptvnator-server:cache:nas:${namespace}`,
                JSON.stringify({ source: ['saved'] })
            );
        const storage = createSourceProfileUserDataStorage(profile, 'nas');
        for (const namespace of SERVER_USER_STATE_NAMESPACES) {
            const raw = localStorage.getItem(
                `iptvnator-server:cache:nas:${namespace}`
            );
            expect(storage.getItem(namespace)).toBe(raw);
            expect(localStorage.getItem(`${profile}:${namespace}`)).toBe(raw);
            storage.removeItem(namespace);
            expect(
                createSourceProfileUserDataStorage(profile, 'nas').getItem(
                    namespace
                )
            ).toBeNull();
            expect(
                localStorage.getItem(`iptvnator-server:cache:nas:${namespace}`)
            ).toBe(raw);
        }
    });
    it('keeps newer profile values and isolates another server and the original library', () => {
        localStorage.setItem(
            'iptvnator-server:cache:nas:xtream-favorites',
            '{"a":["old"]}'
        );
        localStorage.setItem(
            'iptvnator-server:nas:xtream-favorites',
            '{"a":["new"]}'
        );
        localStorage.setItem('xtream-favorites', '{"local":["original"]}');
        expect(
            createSourceProfileUserDataStorage(
                'iptvnator-server:nas',
                'nas'
            ).getItem('xtream-favorites')
        ).toContain('new');
        expect(
            createSourceProfileUserDataStorage(
                'iptvnator-server:other',
                'other'
            ).getItem('xtream-favorites')
        ).toBeNull();
        expect(
            createSourceProfileUserDataStorage('iptvnator').getItem(
                'xtream-favorites'
            )
        ).toContain('original');
    });
    it('does not resurrect old activity when a new-profile write or removal precedes its first read', () => {
        localStorage.setItem(
            'iptvnator-server:cache:nas:xtream-favorites',
            '{"a":["old"]}'
        );
        const storage = createSourceProfileUserDataStorage(
            'iptvnator-server:nas',
            'nas'
        );
        storage.removeItem('xtream-favorites');
        expect(storage.getItem('xtream-favorites')).toBeNull();
        storage.setItem('xtream-favorites', '{}');
        expect(storage.getItem('xtream-favorites')).toBe('{}');
    });
});
