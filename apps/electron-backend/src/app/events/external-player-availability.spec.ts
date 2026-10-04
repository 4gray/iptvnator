import { externalPlayerAvailable } from './external-player-availability';

describe('external player availability', () => {
    const options = {
        platform: 'win32' as const,
        isFlatpak: false,
        searchPath: 'D:\\Players;E:\\Tools',
    };
    it('finds a Windows executable on PATH', () => {
        expect(
            externalPlayerAvailable('mpv', 'mpv', {
                ...options,
                executable: (file) => file === 'E:\\Tools\\mpv.exe',
            })
        ).toBe(true);
    });
    it('disables a missing executable', () => {
        expect(
            externalPlayerAvailable('mpv', 'mpv', {
                ...options,
                executable: () => false,
            })
        ).toBe(false);
    });
    it('honours an invalid custom path instead of falling back to PATH', () => {
        expect(
            externalPlayerAvailable('mpv', 'D:\\Missing\\mpv.exe', {
                ...options,
                executable: (file) => file === 'E:\\Tools\\mpv.exe',
            })
        ).toBe(false);
    });
    it('accepts an existing configured executable with spaces', () => {
        expect(
            externalPlayerAvailable('vlc', 'D:\\Video Players\\vlc.exe', {
                ...options,
                executable: (file) => file === 'D:\\Video Players\\vlc.exe',
            })
        ).toBe(true);
    });
    it('does not disable Flatpak host players based on sandbox files', () => {
        expect(
            externalPlayerAvailable('mpv', undefined, {
                platform: 'linux',
                isFlatpak: true,
                executable: () => false,
            })
        ).toBeNull();
    });
    it('checks executable commands in POSIX PATH', () => {
        expect(
            externalPlayerAvailable('mpv', 'mpv', {
                platform: 'linux',
                isFlatpak: false,
                searchPath: '/opt/bin:/usr/bin',
                executable: (file) => file === '/opt/bin/mpv',
            })
        ).toBe(true);
    });
});
