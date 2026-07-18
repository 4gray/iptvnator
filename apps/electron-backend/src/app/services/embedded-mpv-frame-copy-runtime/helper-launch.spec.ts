import type { Stats } from 'fs';
import path from 'path';
import { createLinuxFrameCopyHelperLaunch } from '../embedded-mpv-frame-copy-runtime';

function fakeStat(
    kind: 'directory' | 'file' | 'symlink'
): Pick<Stats, 'isDirectory' | 'isFile' | 'isSymbolicLink'> {
    return {
        isDirectory: () => kind === 'directory',
        isFile: () => kind === 'file',
        isSymbolicLink: () => kind === 'symlink',
    };
}

describe('createLinuxFrameCopyHelperLaunch', () => {
    const helperArgs = ['--runtime-probe'];

    it.each([
        ['system', '/opt/iptvnator/native/iptvnator_mpv_helper'],
        [
            'bundled',
            '/tmp/.mount-IPTVnator/resources/app.asar.unpacked/electron-backend/native/iptvnator_mpv_helper',
        ],
    ] as const)(
        'launches a non-Snap %s helper directly',
        (runtimeMode, helperPath) => {
            expect(
                createLinuxFrameCopyHelperLaunch({
                    environment: {
                        PATH: '/usr/bin',
                        LD_LIBRARY_PATH: '/tmp/hostile',
                    },
                    helperPath,
                    helperArgs,
                    runtimeMode,
                })
            ).toEqual({
                usable: true,
                command: helperPath,
                args: helperArgs,
                env:
                    runtimeMode === 'system'
                        ? { PATH: '/usr/bin' }
                        : {
                              PATH: '/usr/bin',
                              LD_LIBRARY_PATH: path.join(
                                  path.dirname(helperPath),
                                  'lib'
                              ),
                          },
            });
        }
    );

    it('launches a trusted Snap helper through the connected provider wrapper', () => {
        const snapRoot = '/snap/iptvnator/42';
        const nativeDir = path.join(
            snapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        const helperPath = path.join(nativeDir, 'iptvnator_mpv_helper');
        const graphicsRoot = path.join(snapRoot, 'graphics');
        const wrapperPath = path.join(
            graphicsRoot,
            'bin',
            'graphics-core22-provider-wrapper'
        );
        const lstatSync = jest.fn((candidatePath: string) => {
            if (candidatePath === graphicsRoot) {
                return fakeStat('directory') as Stats;
            }
            if (candidatePath === wrapperPath) {
                return fakeStat('file') as Stats;
            }
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        });
        const accessSync = jest.fn();

        expect(
            createLinuxFrameCopyHelperLaunch({
                environment: {
                    PATH: '/snap/bin:/usr/bin',
                    SNAP: snapRoot,
                },
                helperPath,
                helperArgs,
                runtimeMode: 'bundled',
                fileSystem: { lstatSync, accessSync },
            })
        ).toEqual({
            usable: true,
            command: wrapperPath,
            args: [helperPath, ...helperArgs],
            env: expect.objectContaining({
                PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
                SNAP: snapRoot,
                LD_LIBRARY_PATH: expect.stringContaining(
                    path.join(nativeDir, 'lib')
                ),
            }),
        });
        expect(lstatSync).toHaveBeenCalledWith(graphicsRoot);
        expect(lstatSync).toHaveBeenCalledWith(wrapperPath);
        expect(accessSync).toHaveBeenCalledWith(
            wrapperPath,
            expect.any(Number)
        );
    });

    it.each([
        ['missing mount', 'missing', 'file'],
        ['symlink mount', 'symlink', 'file'],
        ['missing wrapper', 'directory', 'missing'],
        ['symlink wrapper', 'directory', 'symlink'],
    ] as const)(
        'fails closed for a trusted Snap with a %s',
        (_label, mountKind, wrapperKind) => {
            const snapRoot = '/snap/iptvnator/42';
            const nativeDir = path.join(
                snapRoot,
                'resources',
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );
            const helperPath = path.join(nativeDir, 'iptvnator_mpv_helper');
            const graphicsRoot = path.join(snapRoot, 'graphics');
            const wrapperPath = path.join(
                graphicsRoot,
                'bin',
                'graphics-core22-provider-wrapper'
            );

            expect(
                createLinuxFrameCopyHelperLaunch({
                    environment: { SNAP: snapRoot },
                    helperPath,
                    helperArgs,
                    runtimeMode: 'bundled',
                    fileSystem: {
                        lstatSync: (candidatePath) => {
                            const kind =
                                candidatePath === graphicsRoot
                                    ? mountKind
                                    : wrapperKind;
                            if (kind === 'missing') {
                                throw Object.assign(new Error('missing'), {
                                    code: 'ENOENT',
                                });
                            }
                            return fakeStat(kind) as Stats;
                        },
                        accessSync: () => undefined,
                    },
                })
            ).toEqual({
                usable: false,
                reason: 'snap-graphics-provider-unavailable',
            });

            expect(wrapperPath).toContain('/graphics/bin/');
        }
    );

    it('fails closed when the provider wrapper is not executable', () => {
        const snapRoot = '/var/lib/snapd/snap/iptvnator/42';
        const nativeDir = path.join(
            snapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );

        expect(
            createLinuxFrameCopyHelperLaunch({
                environment: { SNAP: snapRoot },
                helperPath: path.join(nativeDir, 'iptvnator_mpv_helper'),
                helperArgs,
                runtimeMode: 'bundled',
                fileSystem: {
                    lstatSync: (candidatePath) =>
                        fakeStat(
                            candidatePath.endsWith('/graphics')
                                ? 'directory'
                                : 'file'
                        ) as Stats,
                    accessSync: () => {
                        throw Object.assign(new Error('denied'), {
                            code: 'EACCES',
                        });
                    },
                },
            })
        ).toEqual({
            usable: false,
            reason: 'snap-graphics-provider-unavailable',
        });
    });
});
