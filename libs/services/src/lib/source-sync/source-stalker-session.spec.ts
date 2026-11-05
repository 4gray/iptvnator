import type { Playlist } from '@iptvnator/shared/interfaces';
import { stalkerSessionFingerprint } from '@iptvnator/shared/interfaces/stalker-session';
import { invalidateObsoleteSourceSession } from './source-stalker-session';

describe('source session verification', () => {
    const confirmed = {
        portalUrl: 'https://portal.test/server/load.php',
        macAddress: '00:1A:79:00:00:01',
        isFullStalkerPortal: true,
        stalkerToken: 'confirmed',
        stalkerWatchdogTimeout: 45,
        serverTimezone: 'Europe/Berlin',
    };
    const session = {
        ...confirmed,
        stalkerSessionIdentity: stalkerSessionFingerprint(confirmed),
    } as Playlist;

    it('retains metadata only for the accepted full-portal connection', () => {
        expect(invalidateObsoleteSourceSession({ ...session })).toEqual(
            session
        );
    });

    it.each([
        { stalkerToken: undefined },
        { macAddress: undefined },
        { password: 'other-account' },
        { isFullStalkerPortal: false },
        { stalkerSessionIdentity: undefined },
    ])('removes an unverified session (%j)', (patch) => {
        const result = invalidateObsoleteSourceSession({
            ...session,
            ...patch,
        });
        for (const field of [
            'stalkerToken',
            'stalkerSessionIdentity',
            'stalkerWatchdogTimeout',
            'serverTimezone',
        ])
            expect(result).not.toHaveProperty(field);
    });
});
