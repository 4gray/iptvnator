import { resolve } from 'node:path';
import {
    createPlaylistOpenRequest,
    extractPlaylistOpenRequestFromArgv,
    isPlaylistFilePath,
    PlaylistOpenRequest,
    PlaylistOpenRequestQueue,
} from './playlist-open-request';

describe('createPlaylistOpenRequest', () => {
    it('accepts m3u and m3u8 paths regardless of case', () => {
        expect(createPlaylistOpenRequest('/tmp/list.m3u')).toMatchObject({
            fileName: 'list.m3u',
            filePath: '/tmp/list.m3u',
        });
        expect(createPlaylistOpenRequest('/tmp/List.M3U8')).toMatchObject({
            fileName: 'List.M3U8',
            filePath: '/tmp/List.M3U8',
        });
    });

    it('rejects paths that are not playlist files', () => {
        expect(createPlaylistOpenRequest('/tmp/movie.mkv')).toBeNull();
        expect(createPlaylistOpenRequest('   ')).toBeNull();
        expect(createPlaylistOpenRequest('')).toBeNull();
    });

    it('resolves a relative path against the supplied working directory', () => {
        expect(
            createPlaylistOpenRequest('sub/list.m3u', '/home/user/playlists')
        ).toMatchObject({
            fileName: 'list.m3u',
            filePath: resolve('/home/user/playlists', 'sub/list.m3u'),
        });
    });

    it('falls back to the process working directory when none is supplied', () => {
        expect(createPlaylistOpenRequest('list.m3u')).toMatchObject({
            fileName: 'list.m3u',
            filePath: resolve(process.cwd(), 'list.m3u'),
        });
    });

    it('gives every request its own id', () => {
        const first = createPlaylistOpenRequest('/tmp/a.m3u');
        const second = createPlaylistOpenRequest('/tmp/a.m3u');

        expect(first?.requestId).toBeTruthy();
        expect(first?.requestId).not.toEqual(second?.requestId);
    });

    it('recognizes playlist extensions through the exported guard', () => {
        expect(isPlaylistFilePath('a.m3u')).toBe(true);
        expect(isPlaylistFilePath('a.m3u8')).toBe(true);
        expect(isPlaylistFilePath('a.m3u.txt')).toBe(false);
    });
});

describe('extractPlaylistOpenRequestFromArgv', () => {
    it('finds the playlist path in a packaged launch', () => {
        expect(
            extractPlaylistOpenRequestFromArgv([
                '/opt/iptvnator/iptvnator',
                '/home/user/list.m3u',
            ])
        ).toMatchObject({
            fileName: 'list.m3u',
            filePath: '/home/user/list.m3u',
        });
    });

    it('skips the executable, switches and the development entry point', () => {
        expect(
            extractPlaylistOpenRequestFromArgv([
                '/usr/bin/electron',
                '--remote-debugging-port=9222',
                '--ozone-platform=x11',
                '/workspace/dist/apps/electron-backend/main.js',
                '/home/user/list.m3u8',
            ])
        ).toMatchObject({
            fileName: 'list.m3u8',
            filePath: '/home/user/list.m3u8',
        });
    });

    it('never treats the executable itself as the playlist', () => {
        expect(
            extractPlaylistOpenRequestFromArgv(['/opt/weird.m3u'])
        ).toBeNull();
    });

    it('returns null when no playlist argument is present', () => {
        expect(
            extractPlaylistOpenRequestFromArgv([
                '/opt/iptvnator/iptvnator',
                '--no-sandbox',
            ])
        ).toBeNull();
    });

    it('resolves a relative argument against the forwarded working directory', () => {
        expect(
            extractPlaylistOpenRequestFromArgv(
                ['/opt/iptvnator/iptvnator', 'list.m3u'],
                '/home/user/tv'
            )
        ).toMatchObject({
            fileName: 'list.m3u',
            filePath: resolve('/home/user/tv', 'list.m3u'),
        });
    });
});

describe('PlaylistOpenRequestQueue', () => {
    const request = (name: string): PlaylistOpenRequest => ({
        fileName: `${name}.m3u`,
        filePath: `/tmp/${name}.m3u`,
        requestId: name,
    });

    it('holds requests until a delivery target is registered', () => {
        const queue = new PlaylistOpenRequestQueue();
        const delivered: PlaylistOpenRequest[] = [];

        queue.enqueue(request('first'));
        queue.enqueue(request('second'));

        queue.setDelivery((entry) => {
            delivered.push(entry);
            return true;
        });

        expect(delivered).toEqual([request('first'), request('second')]);
    });

    it('pushes straight through once a delivery target exists', () => {
        const queue = new PlaylistOpenRequestQueue();
        const delivered: PlaylistOpenRequest[] = [];

        queue.setDelivery((entry) => {
            delivered.push(entry);
            return true;
        });
        queue.enqueue(request('live'));

        expect(delivered).toEqual([request('live')]);
    });

    it('ignores empty requests', () => {
        const queue = new PlaylistOpenRequestQueue();

        queue.enqueue(null);
        queue.enqueue(undefined);

        expect(queue.pendingRequests).toEqual([]);
    });

    it('only drops a request once the renderer acknowledged it', () => {
        const queue = new PlaylistOpenRequestQueue();

        queue.enqueue(request('pending'));
        expect(queue.pendingRequests).toEqual([request('pending')]);

        queue.setDelivery(() => true);
        // Delivered, but `send()` returning proves nothing yet.
        expect(queue.pendingRequests).toEqual([]);
        expect(queue.unacknowledgedRequests).toEqual([request('pending')]);

        queue.acknowledge('pending');
        expect(queue.unacknowledgedRequests).toEqual([]);
    });

    // A reload or a dead render process keeps the WebContents alive, so
    // delivery cannot detect it — only the missing ack can.
    it('replays an unacknowledged request to the next renderer', () => {
        const queue = new PlaylistOpenRequestQueue();
        const secondRendererGot: PlaylistOpenRequest[] = [];

        queue.setDelivery(() => true);
        queue.enqueue(request('reloaded-away'));
        expect(queue.unacknowledgedRequests).toEqual([
            request('reloaded-away'),
        ]);

        queue.setDelivery((entry) => {
            secondRendererGot.push(entry);
            return true;
        });

        expect(secondRendererGot).toEqual([request('reloaded-away')]);
    });

    it('replays unacknowledged requests ahead of newly queued ones', () => {
        const queue = new PlaylistOpenRequestQueue();
        const delivered: PlaylistOpenRequest[] = [];

        queue.setDelivery(() => true);
        queue.enqueue(request('older'));
        queue.setDelivery(null);
        queue.enqueue(request('newer'));

        queue.setDelivery((entry) => {
            delivered.push(entry);
            return true;
        });

        expect(delivered).toEqual([request('older'), request('newer')]);
    });

    it('ignores an acknowledgement for an unknown request', () => {
        const queue = new PlaylistOpenRequestQueue();

        queue.setDelivery(() => true);
        queue.enqueue(request('known'));

        expect(() => queue.acknowledge('stale')).not.toThrow();
        expect(queue.unacknowledgedRequests).toEqual([request('known')]);
    });

    it('keeps a request queued when delivery reports a dead target', () => {
        const queue = new PlaylistOpenRequestQueue();

        queue.setDelivery(() => false);
        queue.enqueue(request('orphan'));

        expect(queue.pendingRequests).toEqual([request('orphan')]);
        expect(queue.unacknowledgedRequests).toEqual([]);
    });

    it('re-arms for the next renderer after a failed delivery', () => {
        const queue = new PlaylistOpenRequestQueue();
        const delivered: PlaylistOpenRequest[] = [];

        queue.setDelivery(() => false);
        queue.enqueue(request('orphan'));

        queue.setDelivery((entry) => {
            delivered.push(entry);
            return true;
        });

        expect(delivered).toEqual([request('orphan')]);
    });

    it('stops delivering at the first failure and preserves order', () => {
        const queue = new PlaylistOpenRequestQueue();
        const delivered: PlaylistOpenRequest[] = [];
        let accept = true;

        queue.enqueue(request('one'));
        queue.enqueue(request('two'));
        queue.setDelivery((entry) => {
            if (!accept) {
                return false;
            }

            delivered.push(entry);
            accept = false;
            return true;
        });

        expect(delivered).toEqual([request('one')]);
        expect(queue.pendingRequests).toEqual([request('two')]);
        expect(queue.unacknowledgedRequests).toEqual([request('one')]);
    });
});
