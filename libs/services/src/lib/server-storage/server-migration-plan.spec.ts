import type { Playlist } from '@iptvnator/shared/interfaces';
import { planServerMigration, sourceIdentity } from './server-migration-plan';

const playlist = (fields: Partial<Playlist> & { _id: string }) =>
    ({ title: fields._id, ...fields }) as Playlist;

describe('planServerMigration', () => {
    it('uploads everything to an empty server', () => {
        const browser = [
            playlist({ _id: 'm', url: 'http://a.test/list.m3u' }),
            playlist({ _id: 'file' }),
        ];

        expect(planServerMigration(browser, [])).toEqual([
            { kind: 'upload', playlist: browser[0] },
            { kind: 'upload', playlist: browser[1] },
        ]);
    });

    it('merges by id first, then by source', () => {
        const server = [
            playlist({ _id: 'moved' }),
            playlist({
                _id: 's-x',
                serverUrl: 'HTTP://Panel.test/',
                username: 'u',
            }),
            playlist({
                _id: 's-st',
                portalUrl: 'http://portal.test/c',
                macAddress: '00:1A:79:AA:BB:CC',
            }),
            playlist({ _id: 's-m', url: 'http://a.test/list.m3u' }),
        ];
        const browser = [
            playlist({ _id: 'moved' }),
            playlist({
                _id: 'b-x',
                serverUrl: 'http://panel.test',
                username: 'u',
            }),
            playlist({
                _id: 'b-st',
                url: 'http://portal.test/c/',
                macAddress: '00:1a:79:aa:bb:cc',
            }),
            playlist({ _id: 'b-m', url: 'http://a.test/list.m3u' }),
            playlist({
                _id: 'b-other',
                serverUrl: 'http://panel.test',
                username: 'other',
            }),
        ];

        expect(planServerMigration(browser, server)).toEqual([
            { kind: 'merge', browserId: 'moved', serverId: 'moved' },
            { kind: 'merge', browserId: 'b-x', serverId: 's-x' },
            { kind: 'merge', browserId: 'b-st', serverId: 's-st' },
            { kind: 'merge', browserId: 'b-m', serverId: 's-m' },
            { kind: 'upload', playlist: browser[4] },
        ]);
    });

    it('collapses browser duplicates of one source onto the first', () => {
        const browser = [
            playlist({ _id: 'one', url: 'http://a.test/list.m3u' }),
            playlist({ _id: 'two', url: 'http://A.test/list.m3u' }),
        ];

        expect(planServerMigration(browser, [])).toEqual([
            { kind: 'upload', playlist: browser[0] },
            { kind: 'merge', browserId: 'two', serverId: 'one' },
        ]);
    });

    it('has no source for a file or pasted M3U', () => {
        expect(sourceIdentity(playlist({ _id: 'file' }))).toBeNull();
    });
});
