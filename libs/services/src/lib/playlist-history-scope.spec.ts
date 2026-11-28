import type { Playlist } from '@iptvnator/shared/interfaces';
import type { HistoryPlaylistBridge } from '../history-events';
import { mutatePlaylistHistory } from './playlist-history';
import {
    ProfileStateUnavailableError,
    setActivePersonalScope,
} from './profiles/active-scope';

const KIDS = 'profile:11111111-1111-4111-8111-111111111111' as const;
const playlist = { _id: 'src', recentlyViewed: [] } as unknown as Playlist;
const bridge = (active: boolean): HistoryPlaylistBridge => ({
    active: () => active,
    project: async (p) => p,
    mutate: async () => null,
});

afterEach(() => setActivePersonalScope('shared'));

describe('playlist history scope', () => {
    it.each([true, false])(
        'refuses to write a profile view into the household archive (bridge active %s)',
        async (active) => {
            const persist = jest.fn(async (p: Playlist) => p);
            setActivePersonalScope(KIDS);
            await expect(
                mutatePlaylistHistory(
                    playlist,
                    { kind: 'clear' },
                    bridge(active),
                    persist
                )
            ).rejects.toBeInstanceOf(ProfileStateUnavailableError);
            expect(persist).not.toHaveBeenCalled();
        }
    );

    it('still writes the household archive for the Default profile', async () => {
        const persist = jest.fn(async (p: Playlist) => p);
        await mutatePlaylistHistory(
            playlist,
            { kind: 'clear' },
            bridge(false),
            persist
        );
        expect(persist).toHaveBeenCalledTimes(1);
    });
});
