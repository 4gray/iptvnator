jest.mock('fs/promises', () => {
    const actual =
        jest.requireActual<typeof import('fs/promises')>('fs/promises');
    return {
        ...actual,
        stat: jest.fn(actual.stat),
        access: jest.fn(actual.access),
    };
});

import { externalPlayerAvailable } from './external-player-availability';
import * as filesystem from 'fs/promises';

describe('external player availability', () => {
    beforeEach(() => {
        jest.mocked(filesystem.stat)
            .mockClear()
            .mockImplementation(
                jest.requireActual<typeof filesystem>('fs/promises').stat
            );
    });
    it.each([
        'D:\\Players\\mpv',
        '.\\Players\\mpv',
        'D:\\Players\\mpv.portable',
    ])('resolves a Windows executable suffix for %s', async (command) => {
        expect(
            await externalPlayerAvailable('mpv', command, {
                platform: 'win32',
                isFlatpak: false,
                executable: (file) => file === command + '.exe',
            })
        ).toBe(true);
    });
    it('finds a bare portable Windows command in the working directory', async () => {
        expect(
            await externalPlayerAvailable('mpv', 'mpv', {
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
    it('finds a Windows executable on PATH', async () => {
        expect(
            await externalPlayerAvailable('mpv', 'mpv', {
                ...options,
                executable: (file) => file === 'E:\\Tools\\mpv.exe',
            })
        ).toBe(true);
    });
    it('disables a missing executable', async () => {
        expect(
            await externalPlayerAvailable('mpv', 'mpv', {
                ...options,
                executable: () => false,
            })
        ).toBe(false);
    });
    it('honours an invalid custom path instead of falling back to PATH', async () => {
        expect(
            await externalPlayerAvailable('mpv', 'D:\\Missing\\mpv.exe', {
                ...options,
                executable: (file) => file === 'E:\\Tools\\mpv.exe',
            })
        ).toBe(false);
    });
    it('accepts an existing configured executable with spaces', async () => {
        expect(
            await externalPlayerAvailable('vlc', 'D:\\Video Players\\vlc.exe', {
                ...options,
                executable: (file) => file === 'D:\\Video Players\\vlc.exe',
            })
        ).toBe(true);
    });
    it('does not disable Flatpak host players based on sandbox files', async () => {
        expect(
            await externalPlayerAvailable('mpv', undefined, {
                platform: 'linux',
                isFlatpak: true,
                executable: () => false,
            })
        ).toBeNull();
    });
    it('checks executable commands in POSIX PATH', async () => {
        expect(
            await externalPlayerAvailable('mpv', 'mpv', {
                platform: 'linux',
                isFlatpak: false,
                searchPath: '/opt/bin:/usr/bin',
                executable: (file) => file === '/opt/bin/mpv',
            })
        ).toBe(true);
    });
    it.each(['/usr/bin:', ':/usr/bin', '/usr/bin::/opt/bin'])(
        'resolves current-directory entries in POSIX PATH %s',
        async (searchPath) => {
            expect(
                await externalPlayerAvailable('mpv', 'mpv', {
                    platform: 'linux',
                    isFlatpak: false,
                    searchPath,
                    workingDirectory: '/portable',
                    executable: (file) => file === '/portable/mpv',
                })
            ).toBe(true);
        }
    );

    it('uses the same default macOS VLC cask executable as playback', async () => {
        const command =
            '/opt/homebrew/Caskroom/vlc/3.0/VLC.app/Contents/MacOS/VLC';
        const executable = jest.fn(async (file) => file === command);
        await expect(
            externalPlayerAvailable('vlc', undefined, {
                platform: 'darwin',
                isFlatpak: false,
                readDirectory: async () => ['3.0'],
                pathExists: async (file) => file === command,
                executable,
            })
        ).resolves.toBe(true);
        expect(executable).toHaveBeenCalledWith(command);
    });

    it('normalizes a custom macOS app bundle before probing', async () => {
        await expect(
            externalPlayerAvailable('mpv', '/Apps/mpv.app/', {
                platform: 'darwin',
                isFlatpak: false,
                executable: async (file) =>
                    file === '/Apps/mpv.app/Contents/MacOS/mpv',
            })
        ).resolves.toBe(true);
    });

    describe.each([
        '\\\\offline\\players\\mpv.exe',
        '//offline/players/mpv.exe',
        '\\\\?\\UNC\\offline\\players\\mpv.exe',
    ])('inaccessible network executable %s', (command) => {
        it.each(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO'])(
            'returns unknown on immediate %s without probing another suffix',
            async (code) => {
                const stat = jest
                    .mocked(filesystem.stat)
                    .mockRejectedValue(
                        Object.assign(
                            new Error('Unavailable filesystem location'),
                            { code }
                        )
                    );
                await expect(
                    externalPlayerAvailable('mpv', command, {
                        platform: 'win32',
                        isFlatpak: false,
                    })
                ).resolves.toBeNull();
                expect(stat).toHaveBeenCalledTimes(1);
            }
        );
    });

    it.each(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'])(
        'distinguishes confirmed local absence from inconclusive %s',
        async (code) => {
            jest.mocked(filesystem.stat).mockRejectedValue(
                Object.assign(new Error('Local filesystem error'), { code })
            );
            await expect(
                externalPlayerAvailable('mpv', 'C:\\missing\\mpv.exe', {
                    platform: 'win32',
                    isFlatpak: false,
                })
            ).resolves.toBe(
                ['ENOENT', 'ENOTDIR'].includes(code) ? false : null
            );
        }
    );

    it.each(['executable', 'pathExists', 'readDirectory'] as const)(
        'keeps the event loop responsive and returns unknown for stalled %s',
        async (operation) => {
            jest.useFakeTimers();
            const stalled = new Promise<never>(() => undefined);
            const executable = jest.fn(async () => false);
            const readDirectory = jest.fn(async () => []);
            const pathExists = jest.fn(async () => false);
            const probes = { executable, readDirectory, pathExists };
            probes[operation] = jest.fn(() => stalled);
            try {
                const probe = externalPlayerAvailable('vlc', undefined, {
                    platform: 'darwin',
                    isFlatpak: false,
                    ...probes,
                    limitMs: 100,
                });
                let heartbeat = false;
                setTimeout(() => {
                    heartbeat = true;
                }, 1);
                await jest.advanceTimersByTimeAsync(100);
                expect(heartbeat).toBe(true);
                await expect(probe).resolves.toBeNull();
            } finally {
                jest.useRealTimers();
            }
        }
    );

    it('stops discovery after a timed-out filesystem operation settles', async () => {
        jest.useFakeTimers();
        let settle: (found: boolean) => void = () => undefined;
        const executable = jest.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    settle = resolve;
                })
        );
        try {
            const probe = externalPlayerAvailable('mpv', 'mpv', {
                ...options,
                executable,
                limitMs: 100,
            });
            await jest.advanceTimersByTimeAsync(100);
            await expect(probe).resolves.toBeNull();
            settle(false);
            await jest.advanceTimersByTimeAsync(1);
            expect(executable).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('bounds native I/O across repeated requests to stalled network paths', async () => {
        jest.useFakeTimers();
        const settle: Array<
            (value: Awaited<ReturnType<typeof filesystem.stat>>) => void
        > = [];
        const stat = jest.mocked(filesystem.stat).mockImplementation(
            () =>
                new Promise((resolve) => {
                    settle.push(resolve);
                })
        );
        const access = jest.mocked(filesystem.access).mockClear();
        try {
            const probes = Array.from({ length: 8 }, (_, index) =>
                externalPlayerAvailable(
                    'mpv',
                    `\\\\offline\\players\\${index}.exe`,
                    {
                        platform: 'win32',
                        isFlatpak: false,
                        limitMs: 100,
                    }
                )
            );
            await jest.advanceTimersByTimeAsync(100);
            await expect(Promise.all(probes)).resolves.toEqual(
                Array(8).fill(null)
            );
            expect(stat).toHaveBeenCalledTimes(2);
            for (const resolve of settle) {
                resolve({ isFile: () => true } as Awaited<
                    ReturnType<typeof filesystem.stat>
                >);
            }
            await jest.advanceTimersByTimeAsync(1);
            expect(stat).toHaveBeenCalledTimes(2);
            expect(access).not.toHaveBeenCalled();
            stat.mockResolvedValue({ isFile: () => false } as Awaited<
                ReturnType<typeof filesystem.stat>
            >);
            await expect(
                externalPlayerAvailable('mpv', 'D:\\missing\\mpv.exe', {
                    platform: 'win32',
                    isFlatpak: false,
                })
            ).resolves.toBe(false);
            expect(stat).toHaveBeenCalledTimes(5);
        } finally {
            stat.mockImplementation(
                jest.requireActual<typeof import('fs/promises')>('fs/promises')
                    .stat
            );
            jest.useRealTimers();
        }
    });

    it.each([
        ['1', 0],
        ['2', 1],
        ['invalid', 0],
    ] as const)(
        'reserves filesystem capacity with UV_THREADPOOL_SIZE=%s',
        async (poolSize, expectedChecks) => {
            const previous = process.env.UV_THREADPOOL_SIZE;
            process.env.UV_THREADPOOL_SIZE = poolSize;
            jest.useFakeTimers();
            const settle: Array<() => void> = [];
            let probe: typeof externalPlayerAvailable = externalPlayerAvailable;
            let stat: jest.MockedFunction<typeof filesystem.stat> = jest.mocked(
                filesystem.stat
            );
            try {
                jest.isolateModules(() => {
                    probe = (
                        require('./external-player-availability') as typeof import('./external-player-availability')
                    ).externalPlayerAvailable;
                    stat = jest.mocked(
                        (require('fs/promises') as typeof filesystem).stat
                    );
                    stat.mockClear().mockImplementation(
                        () =>
                            new Promise((resolve) => {
                                settle.push(() =>
                                    resolve({ isFile: () => false } as Awaited<
                                        ReturnType<typeof filesystem.stat>
                                    >)
                                );
                            })
                    );
                });
                const requests = Array.from({ length: 4 }, () =>
                    probe('mpv', 'D:\\missing\\mpv.exe', {
                        platform: 'win32',
                        isFlatpak: false,
                        limitMs: 100,
                    })
                );
                await jest.advanceTimersByTimeAsync(100);
                await expect(Promise.all(requests)).resolves.toEqual(
                    Array(4).fill(null)
                );
                expect(stat).toHaveBeenCalledTimes(expectedChecks);
            } finally {
                settle.forEach((resolve) => resolve());
                await jest.advanceTimersByTimeAsync(1);
                jest.useRealTimers();
                if (previous === undefined)
                    delete process.env.UV_THREADPOOL_SIZE;
                else process.env.UV_THREADPOOL_SIZE = previous;
            }
        }
    );
});
