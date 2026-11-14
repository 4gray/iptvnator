import { HtmlVideoElementSession } from './html-video-element-session';

describe('HtmlVideoElementSession saved volume and mute', () => {
    function attach(video: HTMLVideoElement): HtmlVideoElementSession {
        const session = new HtmlVideoElementSession({
            video,
            getChannelUrl: () => 'https://example.test/video.ts',
            getStartTime: () => 0,
            emitPlaybackIssue: jest.fn(),
            emitTimeUpdate: jest.fn(),
            emitPlaybackEnded: jest.fn(),
        });
        session.attach();
        return session;
    }

    afterEach(() => localStorage.removeItem('volume'));

    it('keeps the saved volume when only the mute state changes', () => {
        localStorage.setItem('volume', '0.25');
        const video = document.createElement('video');
        const session = attach(video);

        // A multiview session mutes and later unmutes a tile at level 1;
        // the element fires volumechange for each.
        video.muted = true;
        video.muted = false;

        expect(localStorage.getItem('volume')).toBe('0.25');
        session.destroy();
    });

    it('still saves a level the viewer sets, muted or not', () => {
        const video = document.createElement('video');
        const session = attach(video);

        video.muted = true;
        video.volume = 0.6;

        expect(localStorage.getItem('volume')).toBe('0.6');
        session.destroy();
    });
});
