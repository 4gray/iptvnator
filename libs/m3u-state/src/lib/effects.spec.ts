import { Channel } from 'shared-interfaces';
import { buildExternalPlayerPayload } from './external-player-payload.util';

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
});
