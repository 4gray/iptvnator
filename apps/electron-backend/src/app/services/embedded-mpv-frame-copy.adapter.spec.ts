import { EventEmitter } from 'events';
import type { Stats } from 'fs';
import path from 'path';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { EmbeddedMpvFrameCopyAdapter } from './embedded-mpv-frame-copy.adapter';
import type { EmbeddedMpvFrameCopyRuntimeMode } from './embedded-mpv-frame-copy-runtime';

const HOSTILE_LOADER_ENVIRONMENT = {
    BASH_ENV: '/tmp/hostile-bash-env',
    ENV: '/tmp/hostile-shell-env',
    BASHOPTS: 'extdebug',
    SHELLOPTS: 'xtrace',
    PS4: '$(/tmp/hostile-trace-hook)',
    BASH_XTRACEFD: '9',
    CDPATH: '/tmp/hostile-cdpath',
    'BASH_FUNC_dirname%%': '() { printf /tmp/hostile-provider-root; exit 0; }',
    LD_AUDIT: '/tmp/audit.so',
    LD_LIBRARY_PATH: '/tmp/hostile-libs',
    LD_ORIGIN_PATH: '/tmp/hostile-origin',
    LD_PRELOAD: '/tmp/inject.so',
    __EGL_VENDOR_LIBRARY_FILENAMES: '/tmp/hostile-egl-vendor.json',
    __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor-dir',
    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS: '/tmp/hostile-egl-platform',
    __EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES: '/tmp/hostile-egl-platform.json',
    GBM_BACKEND: '../../../../../tmp/hostile-gbm',
    GBM_BACKENDS_PATH: '/tmp/hostile-gbm-path',
    LIBGL_DRIVERS_PATH: '/tmp/hostile-dri-path',
    MESA_LOADER_DRIVER_OVERRIDE: '../../../../../tmp/hostile-dri',
    LIBVA_DRIVER_NAME: '../../../../../tmp/hostile-va',
    LIBVA_DRIVERS_PATH: '/tmp/hostile-va-path',
    VDPAU_DRIVER_PATH: '/tmp/hostile-vdpau',
    VK_DRIVER_FILES: '/tmp/hostile-vulkan-driver.json',
    VK_ICD_FILENAMES: '/tmp/hostile-vulkan-icd.json',
    VK_ADD_DRIVER_FILES: '/tmp/hostile-vulkan-add-driver.json',
    VK_ADD_LAYER_PATH: '/tmp/hostile-vulkan-layers',
    VK_IMPLICIT_LAYER_PATH: '/tmp/hostile-vulkan-implicit-layers',
    VK_ADD_IMPLICIT_LAYER_PATH: '/tmp/hostile-vulkan-add-implicit-layers',
    VK_LAYER_PATH: '/tmp/hostile-vulkan-layer-path',
} as const;

const GRAPHICS_SELECTOR_ENVIRONMENT = {
    LIBGL_ALWAYS_SOFTWARE: '1',
    GALLIUM_DRIVER: 'llvmpipe',
} as const;

function fakeStat(
    kind: 'directory' | 'file'
): Pick<Stats, 'isDirectory' | 'isFile' | 'isSymbolicLink'> {
    return {
        isDirectory: () => kind === 'directory',
        isFile: () => kind === 'file',
        isSymbolicLink: () => false,
    };
}

class FakeHelperProcess extends EventEmitter {
    exitCode: number | null = null;
    readonly stdout = new EventEmitter();
    readonly stderr = new EventEmitter();
    readonly stdin = {
        writable: true,
        written: [] as string[],
        write(line: string) {
            this.written.push(line);
            return true;
        },
    };
    readonly kill = jest.fn((signal?: string) => {
        this.exitCode = 0;
        this.emit('exit', 0, signal ?? null);
        return true;
    });

    emitStdout(payload: object): void {
        this.stdout.emit('data', Buffer.from(`${JSON.stringify(payload)}\n`));
    }
}

describe('EmbeddedMpvFrameCopyAdapter', () => {
    let child: FakeHelperProcess;
    let frameSourceChanges: Array<{ sessionId: string; shmName: string }>;
    let adapter: EmbeddedMpvFrameCopyAdapter;

    const createAdapter = (
        helperPath: string | null = '/native/helper',
        {
            runtimeMode = 'system',
            environment,
            helperLaunchFileSystem,
        }: {
            runtimeMode?: EmbeddedMpvFrameCopyRuntimeMode | null;
            environment?: NodeJS.ProcessEnv;
            helperLaunchFileSystem?: {
                lstatSync(filePath: string): Stats;
                accessSync(filePath: string, mode: number): void;
            };
        } = {}
    ) => {
        frameSourceChanges = [];
        return new EmbeddedMpvFrameCopyAdapter({
            resolveHelperPath: () => helperPath,
            resolveRuntimeMode: () => runtimeMode,
            environment,
            helperLaunchFileSystem,
            getScaleFactor: () => 2,
            onFrameSourceChanged: (sessionId, source) =>
                frameSourceChanges.push({
                    sessionId,
                    shmName: source.shmName,
                }),
        } as ConstructorParameters<typeof EmbeddedMpvFrameCopyAdapter>[0]);
    };

    beforeEach(() => {
        jest.useFakeTimers();
        child = new FakeHelperProcess();
        spawnMock.mockReset();
        spawnMock.mockReturnValue(child);
        adapter = createAdapter();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const createSession = () =>
        adapter.createSession(
            Buffer.alloc(0),
            { x: 0, y: 0, width: 640, height: 360 },
            'Title',
            0.8
        );

    it('spawns the helper with device-pixel size and initial volume', () => {
        const sessionId = createSession();
        expect(sessionId).toMatch(/^impv-fc-/);
        const [helperPath, args] = spawnMock.mock.calls[0];
        expect(helperPath).toBe('/native/helper');
        expect(args).toEqual([
            '--shm-base',
            `/${sessionId}`,
            '--width',
            '1280',
            '--height',
            '720',
            '--volume',
            '0.8',
        ]);
    });

    describe('Linux loader environment', () => {
        const originalPlatform = process.platform;
        const originalArch = process.arch;

        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
        });

        afterEach(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
            Object.defineProperty(process, 'arch', { value: originalArch });
        });

        it('uses a sanitized system environment for the real helper session', () => {
            adapter = createAdapter('/opt/iptvnator/native/helper', {
                runtimeMode: 'system',
                environment: {
                    PATH: '/usr/bin',
                    HOME: '/home/user',
                    ...HOSTILE_LOADER_ENVIRONMENT,
                    ...GRAPHICS_SELECTOR_ENVIRONMENT,
                },
            });

            createSession();

            expect(spawnMock.mock.calls[0][2]).toEqual({
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    PATH: '/usr/bin',
                    HOME: '/home/user',
                    ...GRAPHICS_SELECTOR_ENVIRONMENT,
                },
            });
        });

        it('keeps trusted Snap GL roots ahead of generic Snap libraries for playback', () => {
            const snapRoot = '/snap/iptvnator/42';
            const nativeDir = path.join(
                snapRoot,
                'resources',
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );
            adapter = createAdapter(path.join(nativeDir, 'helper'), {
                runtimeMode: 'bundled',
                helperLaunchFileSystem: {
                    lstatSync: (candidatePath) =>
                        fakeStat(
                            candidatePath.endsWith('/graphics')
                                ? 'directory'
                                : 'file'
                        ) as Stats,
                    accessSync: () => undefined,
                },
                environment: {
                    PATH: '/snap/bin:/usr/bin',
                    SNAP: snapRoot,
                    SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl:/tmp/hostile-gl',
                    SNAP_DESKTOP_ARCH_TRIPLET: 'hostile-linux-gnu',
                    SNAP_DESKTOP_RUNTIME: path.join(snapRoot, 'gnome-platform'),
                    GBM_BACKENDS_PATH: '/tmp/hostile-gbm',
                    LIBGL_DRIVERS_PATH: '/tmp/hostile-dri',
                    LIBVA_DRIVERS_PATH: '/tmp/hostile-va',
                    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS:
                        '/tmp/hostile-egl-platform',
                    __EGL_VENDOR_LIBRARY_DIRS: '/tmp/hostile-egl-vendor',
                    VK_LAYER_PATH: '/tmp/hostile-vulkan',
                    XDG_CONFIG_HOME: '/tmp/hostile-xdg-config-home',
                    XDG_CONFIG_DIRS: '/tmp/hostile-xdg-config-dirs',
                    XDG_DATA_HOME: '/tmp/hostile-xdg-data-home',
                    XDG_DATA_DIRS: '/tmp/hostile-xdg-data-dirs',
                    ...HOSTILE_LOADER_ENVIRONMENT,
                    ...GRAPHICS_SELECTOR_ENVIRONMENT,
                },
            });

            createSession();

            expect(spawnMock.mock.calls[0][0]).toBe(
                path.join(
                    snapRoot,
                    'graphics',
                    'bin',
                    'graphics-core22-provider-wrapper'
                )
            );
            expect(spawnMock.mock.calls[0][1][0]).toBe(
                path.join(nativeDir, 'helper')
            );
            expect(spawnMock.mock.calls[0][2]).toEqual({
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
                    SNAP: snapRoot,
                    SNAP_LIBRARY_PATH: '/var/lib/snapd/lib/gl',
                    SNAP_ARCH: 'amd64',
                    SNAP_DESKTOP_ARCH_TRIPLET: 'x86_64-linux-gnu',
                    SNAP_DESKTOP_RUNTIME: path.join(snapRoot, 'gnome-platform'),
                    ...GRAPHICS_SELECTOR_ENVIRONMENT,
                    GBM_BACKENDS_PATH: [
                        path.join(
                            snapRoot,
                            'graphics',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu',
                            'gbm'
                        ),
                        '/var/lib/snapd/lib/gl/gbm',
                    ].join(':'),
                    LIBGL_DRIVERS_PATH: path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'dri'
                    ),
                    LIBVA_DRIVERS_PATH: path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'lib',
                        'x86_64-linux-gnu',
                        'dri'
                    ),
                    __EGL_EXTERNAL_PLATFORM_CONFIG_DIRS: path.join(
                        snapRoot,
                        'graphics',
                        'usr',
                        'share',
                        'egl',
                        'egl_external_platform.d'
                    ),
                    __EGL_VENDOR_LIBRARY_DIRS: [
                        '/var/lib/snapd/lib/glvnd/egl_vendor.d',
                        path.join(
                            snapRoot,
                            'graphics',
                            'usr',
                            'share',
                            'glvnd',
                            'egl_vendor.d'
                        ),
                    ].join(':'),
                    VK_LAYER_PATH: [
                        path.join(
                            snapRoot,
                            'graphics',
                            'usr',
                            'share',
                            'vulkan',
                            'implicit_layer.d'
                        ),
                        path.join(
                            snapRoot,
                            'graphics',
                            'usr',
                            'share',
                            'vulkan',
                            'explicit_layer.d'
                        ),
                    ].join(':'),
                    XDG_CONFIG_HOME: path.join(snapRoot, 'etc', 'xdg'),
                    XDG_CONFIG_DIRS: [
                        path.join(snapRoot, 'etc', 'xdg'),
                        '/etc/xdg',
                    ].join(':'),
                    XDG_DATA_HOME: path.join(snapRoot, 'usr', 'share'),
                    XDG_DATA_DIRS: [
                        path.join(snapRoot, 'graphics', 'usr', 'share'),
                        path.join(snapRoot, 'gnome-platform', 'usr', 'share'),
                        path.join(snapRoot, 'usr', 'share'),
                        '/usr/share',
                    ].join(':'),
                    LD_LIBRARY_PATH: [
                        path.join(nativeDir, 'lib'),
                        '/var/lib/snapd/lib/gl',
                        path.join(
                            snapRoot,
                            'graphics',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu'
                        ),
                        path.join(
                            snapRoot,
                            'graphics',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu',
                            'vdpau'
                        ),
                        path.join(
                            snapRoot,
                            'gnome-platform',
                            'lib',
                            'x86_64-linux-gnu'
                        ),
                        path.join(
                            snapRoot,
                            'gnome-platform',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu'
                        ),
                        path.join(
                            snapRoot,
                            'gnome-platform',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu',
                            'mesa'
                        ),
                        path.join(
                            snapRoot,
                            'gnome-platform',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu',
                            'mesa-egl'
                        ),
                        path.join(
                            snapRoot,
                            'gnome-platform',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu',
                            'dri'
                        ),
                        path.join(
                            snapRoot,
                            'gnome-platform',
                            'usr',
                            'lib',
                            'x86_64-linux-gnu',
                            'pulseaudio'
                        ),
                        path.join(snapRoot, 'lib'),
                        path.join(snapRoot, 'usr', 'lib'),
                        path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
                        path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
                    ].join(':'),
                },
            });
        });

        it('refuses a Linux session without a validated runtime mode', () => {
            adapter = createAdapter('/native/helper', { runtimeMode: null });

            expect(() => createSession()).toThrow(
                'validated Linux frame-copy runtime'
            );
            expect(spawnMock).not.toHaveBeenCalled();
        });
    });

    it('caches helper snapshot events for getSessionSnapshot', () => {
        const sessionId = createSession();
        child.emitStdout({
            event: 'snapshot',
            status: 'playing',
            positionSeconds: 12.5,
            durationSeconds: 60,
            volume: 0.8,
            streamUrl: 'http://stream',
            audioTracks: [],
            selectedAudioTrackId: null,
            subtitleTracks: [],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: { active: false },
        });
        const snapshot = adapter.getSessionSnapshot(sessionId);
        expect(snapshot?.status).toBe('playing');
        expect(snapshot?.positionSeconds).toBe(12.5);
        expect(snapshot?.streamUrl).toBe('http://stream');
    });

    it('publishes shm generations through onFrameSourceChanged', () => {
        const sessionId = createSession();
        child.emitStdout({
            event: 'shm',
            name: `/${sessionId}-g1`,
            width: 1280,
            height: 720,
            generation: 1,
        });
        expect(frameSourceChanges).toEqual([
            { sessionId, shmName: `/${sessionId}-g1` },
        ]);
        // path.join output is host-specific; build the expectation the
        // same way so the spec passes on Windows checkouts too.
        expect(adapter.getFrameSource(sessionId)?.readerPath).toBe(
            path.join('/native', 'embedded_mpv_frame_reader.node')
        );
    });

    it('encodes loadfile options with percent-escaping', () => {
        const sessionId = createSession();
        adapter.loadPlayback(sessionId, {
            streamUrl: 'http://host/live.m3u8',
            title: 'Tab\there',
            userAgent: 'UA 1.0',
            startTime: 42,
            headers: { 'X-Token': 'abc' },
        });
        const line = child.stdin.written.at(-1) ?? '';
        expect(line.startsWith('load\turl=http://host/live.m3u8\t')).toBe(true);
        expect(line).toContain('opt.force-media-title=Tab%09here');
        expect(line).toContain('opt.user-agent=UA 1.0');
        expect(line).toContain('opt.start=42');
        expect(line).toContain('opt.http-header-fields=X-Token: abc');
    });

    it('scales bounds and ignores hidden/degenerate bounds', () => {
        const sessionId = createSession();
        adapter.setBounds(sessionId, { x: 0, y: 0, width: 800, height: 450 });
        expect(child.stdin.written.at(-1)).toBe(
            'size\twidth=1600\theight=900\n'
        );
        const writesBefore = child.stdin.written.length;
        adapter.setBounds(sessionId, {
            x: -10000,
            y: -10000,
            width: 1,
            height: 1,
        });
        expect(child.stdin.written.length).toBe(writesBefore);
    });

    it('maps an unexpected helper exit to a session error', () => {
        const sessionId = createSession();
        child.exitCode = 1;
        child.emit('exit', 1, null);
        const snapshot = adapter.getSessionSnapshot(sessionId);
        expect(snapshot?.status).toBe('error');
        expect(snapshot?.error).toContain('exited unexpectedly');
    });

    it('disposes with quit and escalates to SIGTERM', () => {
        const sessionId = createSession();
        adapter.disposeSession(sessionId);
        expect(child.stdin.written.at(-1)).toBe('quit\n');
        expect(adapter.getSessionSnapshot(sessionId)).toBeNull();
        child.exitCode = null; // helper ignored quit
        jest.advanceTimersByTime(600);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('reports unsupported without a helper binary', () => {
        const withoutHelper = createAdapter(null);
        expect(withoutHelper.isSupported()).toBe(false);
    });

    describe('isSupported platform gate', () => {
        const originalPlatform = process.platform;
        const originalArch = process.arch;

        afterEach(() => {
            Object.defineProperty(process, 'platform', {
                value: originalPlatform,
            });
            Object.defineProperty(process, 'arch', { value: originalArch });
        });

        it.each<[NodeJS.Platform, string, boolean]>([
            ['darwin', 'arm64', true],
            ['darwin', 'x64', false],
            ['linux', 'x64', true],
            ['linux', 'arm64', false],
            ['win32', 'x64', true],
            ['freebsd', 'x64', false],
        ])(
            'on %s/%s with a helper binary present -> %s',
            (platform, arch, expected) => {
                Object.defineProperty(process, 'platform', {
                    value: platform,
                });
                Object.defineProperty(process, 'arch', { value: arch });
                expect(adapter.isSupported()).toBe(expected);
            }
        );
    });
});
