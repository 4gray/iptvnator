import { EventEmitter } from 'events';
import type { Stats } from 'fs';
import { EmbeddedMpvFrameCopyAdapter } from './embedded-mpv-frame-copy.adapter';
import type { EmbeddedMpvFrameCopyRuntimeMode } from './embedded-mpv-frame-copy-runtime';

/**
 * Shared fixtures for the frame-copy adapter specs. The `child_process` spawn
 * mock stays in each spec file (it must be registered before the adapter is
 * imported), and is handed to `createFrameCopyAdapter` via the spec's own
 * `beforeEach`.
 */

/**
 * Every loader/shell override the sanitized helper environment must strip.
 * Kept in one place so both specs assert against the same hostile input.
 */
export const HOSTILE_LOADER_ENVIRONMENT = {
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

/** Selectors that must survive sanitization (CI uses them for llvmpipe). */
export const GRAPHICS_SELECTOR_ENVIRONMENT = {
    LIBGL_ALWAYS_SOFTWARE: '1',
    GALLIUM_DRIVER: 'llvmpipe',
} as const;

export function fakeStat(
    kind: 'directory' | 'file'
): Pick<Stats, 'isDirectory' | 'isFile' | 'isSymbolicLink'> {
    return {
        isDirectory: () => kind === 'directory',
        isFile: () => kind === 'file',
        isSymbolicLink: () => false,
    };
}

export class FakeHelperProcess extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;
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

export interface CreateFrameCopyAdapterOptions {
    runtimeMode?: EmbeddedMpvFrameCopyRuntimeMode | null;
    environment?: NodeJS.ProcessEnv;
    helperLaunchFileSystem?: {
        lstatSync(filePath: string): Stats;
        accessSync(filePath: string, mode: number): void;
    };
}

export interface FrameSourceChange {
    sessionId: string;
    shmName: string;
}

/**
 * Build an adapter plus the list that records its frame-source callbacks.
 * `getScaleFactor` is fixed at 2 so specs can assert device-pixel maths.
 */
export function createFrameCopyAdapter(
    helperPath: string | null = '/native/helper',
    {
        runtimeMode = 'system',
        environment,
        helperLaunchFileSystem,
    }: CreateFrameCopyAdapterOptions = {}
): {
    adapter: EmbeddedMpvFrameCopyAdapter;
    frameSourceChanges: FrameSourceChange[];
} {
    const frameSourceChanges: FrameSourceChange[] = [];
    const adapter = new EmbeddedMpvFrameCopyAdapter({
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
    return { adapter, frameSourceChanges };
}

/** The standard 640x360 session every spec opens. */
export function createFrameCopySession(
    adapter: EmbeddedMpvFrameCopyAdapter
): string {
    return adapter.createSession(
        Buffer.alloc(0),
        { x: 0, y: 0, width: 640, height: 360 },
        'Title',
        0.8
    );
}
