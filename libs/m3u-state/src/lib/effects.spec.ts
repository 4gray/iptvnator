import { Channel, EpgProgram, VideoPlayer } from '@iptvnator/shared/interfaces';
import { EpgActions } from './actions';
import {
    buildExternalPlayerPayload,
    shouldAutoLaunchExternalPlayer,
} from './external-player-payload.util';
import { resolveActiveEpgProgramAction } from './resolve-active-epg-program.util';

describe('buildExternalPlayerPayload', () => {
    const activeChannel: Channel = {
        id: 'channel-1',
        name: 'Sample TV',
        url: 'https://streams.example.com/live.m3u8',
        group: { title: 'News' },
        tvg: {
            id: 'sample-tv',
            name: 'Sample TV',
            url: '',
            logo: '',
            rec: '3',
        },
        catchup: {
            type: 'shift',
            days: '3',
        },
        timeshift: '3',
        http: {
            referrer: 'https://referrer.example.com',
            'user-agent': 'Codex Test Agent',
            origin: 'https://origin.example.com',
        },
        radio: 'false',
        epgParams: '',
    };

    it('uses the resolved archive url while preserving headers and title', () => {
        expect(
            buildExternalPlayerPayload(
                activeChannel,
                'https://archive.example.com/replay.m3u8?utc=123&lutc=456'
            )
        ).toEqual({
            url: 'https://archive.example.com/replay.m3u8?utc=123&lutc=456',
            title: 'Sample TV',
            'user-agent': 'Codex Test Agent',
            referer: 'https://referrer.example.com',
            origin: 'https://origin.example.com',
        });
    });

    describe('shouldAutoLaunchExternalPlayer', () => {
        const mpvSettings = { player: VideoPlayer.MPV };

        it('launches the configured external player for regular channels', () => {
            expect(
                shouldAutoLaunchExternalPlayer(
                    mpvSettings,
                    true,
                    activeChannel,
                    VideoPlayer.MPV
                )
            ).toBe(true);
            expect(
                shouldAutoLaunchExternalPlayer(
                    mpvSettings,
                    true,
                    activeChannel,
                    VideoPlayer.VLC
                )
            ).toBe(false);
        });

        it('never launches external players for DASH (.mpd) channels', () => {
            const dashChannel: Channel = {
                ...activeChannel,
                url: 'https://streams.example.com/live.mpd',
            };

            expect(
                shouldAutoLaunchExternalPlayer(
                    mpvSettings,
                    true,
                    dashChannel,
                    VideoPlayer.MPV
                )
            ).toBe(false);
            expect(
                shouldAutoLaunchExternalPlayer(
                    { player: VideoPlayer.VLC },
                    true,
                    dashChannel,
                    VideoPlayer.VLC
                )
            ).toBe(false);
        });

        it('never launches external players for radio channels', () => {
            expect(
                shouldAutoLaunchExternalPlayer(
                    mpvSettings,
                    true,
                    { ...activeChannel, radio: 'true' },
                    VideoPlayer.MPV
                )
            ).toBe(false);
        });

        it('respects the double-click setting and missing settings', () => {
            expect(
                shouldAutoLaunchExternalPlayer(
                    { ...mpvSettings, openStreamOnDoubleClick: true },
                    undefined,
                    activeChannel,
                    VideoPlayer.MPV
                )
            ).toBe(false);
            expect(
                shouldAutoLaunchExternalPlayer(
                    { ...mpvSettings, openStreamOnDoubleClick: true },
                    true,
                    activeChannel,
                    VideoPlayer.MPV
                )
            ).toBe(true);
            expect(
                shouldAutoLaunchExternalPlayer(
                    null,
                    true,
                    activeChannel,
                    VideoPlayer.MPV
                )
            ).toBe(false);
            expect(
                shouldAutoLaunchExternalPlayer(
                    {},
                    true,
                    activeChannel,
                    VideoPlayer.MPV
                )
            ).toBe(false);
        });
    });
});

describe('resolveActiveEpgProgramAction', () => {
    const program: EpgProgram = {
        start: '2026-07-05T09:00:00+03:00',
        stop: '2026-07-05T10:50:00+03:00',
        channel: 'sample-tv',
        title: 'Archived show',
        desc: null,
        category: null,
    };

    const catchupChannel: Channel = {
        id: 'channel-1',
        name: 'Sample TV',
        url: 'https://streams.example.com/live.m3u8',
        group: { title: 'News' },
        tvg: {
            id: 'sample-tv',
            name: 'Sample TV',
            url: '',
            logo: '',
            rec: '3',
        },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
        epgParams: '',
    } as Channel;

    it('resolves a catch-up url for a channel with archive support', () => {
        const onUnavailable = jest.fn();

        const action = resolveActiveEpgProgramAction(
            program,
            catchupChannel,
            onUnavailable
        ) as ReturnType<typeof EpgActions.setActivePlaybackUrl>;

        expect(action.type).toBe(EpgActions.setActivePlaybackUrl.type);
        expect(action.playbackUrl).toContain(
            'https://streams.example.com/live.m3u8?utc='
        );
        expect(action.program).toEqual(program);
        expect(onUnavailable).not.toHaveBeenCalled();
    });

    it('notifies and resets when the channel exposes no catch-up window', () => {
        const onUnavailable = jest.fn();

        const action = resolveActiveEpgProgramAction(
            program,
            {
                ...catchupChannel,
                tvg: { ...catchupChannel.tvg, rec: '' },
            } as Channel,
            onUnavailable
        );

        expect(action.type).toBe(EpgActions.resetActiveEpgProgram.type);
        expect(onUnavailable).toHaveBeenCalledTimes(1);
    });

    it('notifies and resets when there is no active channel', () => {
        const onUnavailable = jest.fn();

        const action = resolveActiveEpgProgramAction(
            program,
            undefined,
            onUnavailable
        );

        expect(action.type).toBe(EpgActions.resetActiveEpgProgram.type);
        expect(onUnavailable).toHaveBeenCalledTimes(1);
    });
});
