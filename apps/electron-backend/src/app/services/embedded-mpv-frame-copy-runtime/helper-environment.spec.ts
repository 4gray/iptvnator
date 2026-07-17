import path from 'path';
import { createLinuxFrameCopyHelperEnvironment } from '../embedded-mpv-frame-copy-runtime';

describe('createLinuxFrameCopyHelperEnvironment', () => {
    it('removes ambient loader overrides for system packages', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/usr/bin',
                    HOME: '/home/user',
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                '/opt/iptvnator/native',
                'system'
            )
        ).toEqual({
            PATH: '/usr/bin',
            HOME: '/home/user',
        });
    });

    it('keeps trusted Snap GL roots ahead of generic Snap libraries', () => {
        const snapRoot = '/snap/iptvnator/42';
        const nativeDir = path.join(
            snapRoot,
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );

        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/snap/bin:/usr/bin',
                    SNAP: snapRoot,
                    SNAP_LIBRARY_PATH: [
                        '/var/lib/snapd/lib/gl',
                        '/tmp/hostile-gl',
                        '/var/lib/snapd/lib/gl/nvidia',
                        '/var/lib/snapd/lib/gl-evil',
                    ].join(':'),
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                nativeDir,
                'bundled'
            )
        ).toEqual({
            PATH: '/snap/bin:/usr/bin',
            SNAP: snapRoot,
            SNAP_LIBRARY_PATH: [
                '/var/lib/snapd/lib/gl',
                '/tmp/hostile-gl',
                '/var/lib/snapd/lib/gl/nvidia',
                '/var/lib/snapd/lib/gl-evil',
            ].join(':'),
            LD_LIBRARY_PATH: [
                path.join(nativeDir, 'lib'),
                '/var/lib/snapd/lib/gl',
                '/var/lib/snapd/lib/gl/nvidia',
                path.join(snapRoot, 'lib'),
                path.join(snapRoot, 'usr', 'lib'),
                path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
                path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
            ].join(':'),
        });
    });

    it('does not trust Snap loader paths when nativeDir is outside the declared mount', () => {
        expect(
            createLinuxFrameCopyHelperEnvironment(
                {
                    PATH: '/usr/bin',
                    SNAP: '/snap/iptvnator/42',
                    SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
                    LD_LIBRARY_PATH: '/tmp/hostile-libs',
                    LD_PRELOAD: '/tmp/inject.so',
                },
                '/opt/iptvnator/native',
                'bundled'
            )
        ).toEqual({
            PATH: '/usr/bin',
            SNAP: '/snap/iptvnator/42',
            SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
            LD_LIBRARY_PATH: '/opt/iptvnator/native/lib',
        });
    });
});
