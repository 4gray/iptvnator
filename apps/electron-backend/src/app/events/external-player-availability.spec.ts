import { externalPlayerAvailable } from './external-player-availability';

describe('external player availability', () => {
    it.each(['D:\\Players\\mpv', '.\\Players\\mpv', 'D:\\Players\\mpv.portable'])(
        'resolves a Windows executable suffix for %s',
        (command) => {
            expect(
                externalPlayerAvailable('mpv', command, {
                    platform: 'win32',
                    isFlatpak: false,
                    executable: (file) => file === command + '.exe',
                })
            ).toBe(true);
        }
    );
    it('finds a bare portable Windows command in the working directory', () => {
        expect(
            externalPlayerAvailable('mpv', 'mpv', {
                platform: 'win32',
                isFlatpak: false,
                searchPath: '',
                workingDirectory: 'D:\\Portable',
                executable: (file) => file === 'D:\\Portable\\mpv.exe',
            })
        ).toBe(true);
    });
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
    it.each(['/usr/bin:', ':/usr/bin', '/usr/bin::/opt/bin'])(
        'resolves current-directory entries in POSIX PATH %s',
        (searchPath) => {
            expect(
                externalPlayerAvailable('mpv', 'mpv', {
                    platform: 'linux',
                    isFlatpak: false,
                    searchPath,
                    workingDirectory: '/portable',
                    executable: (file) => file === '/portable/mpv',
                })
            ).toBe(true);
        }
    );
});
