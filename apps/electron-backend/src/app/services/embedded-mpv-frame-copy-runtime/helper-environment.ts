import path from 'path';
import type { EmbeddedMpvFrameCopyRuntimeMode } from './types';
import { resolveTrustedSnapRoot } from './trusted-snap-root';

const TRUSTED_SNAP_GL_ROOT = '/var/lib/snapd/lib/gl';
const TRUSTED_SNAP_EGL_VENDOR_ROOT = '/var/lib/snapd/lib/glvnd/egl_vendor.d';
const SNAP_DESKTOP_RUNTIME_DIRECTORY = 'gnome-platform';
const SNAP_GRAPHICS_RUNTIME_DIRECTORY = 'graphics';
const SNAP_X64_LIBRARY_TRIPLET = 'x86_64-linux-gnu';
const TRUSTED_SNAP_BASE_LIBRARY_ROOT = '/usr/lib/x86_64-linux-gnu';
const TRUSTED_SNAP_HELPER_PATH = '/usr/sbin:/usr/bin:/sbin:/bin';
const TRUSTED_FLATPAK_APP_ID = 'com.fourgray.iptvnator';
const TRUSTED_FLATPAK_APP_ROOT = '/app';
const TRUSTED_FLATPAK_EGL_EXTERNAL_PLATFORM_CONFIG_DIRS = [
    '/etc/egl/egl_external_platform.d',
    '/usr/lib/x86_64-linux-gnu/GL/egl/egl_external_platform.d',
    '/usr/share/egl/egl_external_platform.d',
].join(':');
const UNSAFE_HELPER_ENVIRONMENT_VARIABLES = [
    'BASH_ENV',
    'ENV',
    'BASHOPTS',
    'SHELLOPTS',
    'PS4',
    'BASH_XTRACEFD',
    'CDPATH',
    'LD_AUDIT',
    'LD_LIBRARY_PATH',
    'LD_ORIGIN_PATH',
    'LD_PRELOAD',
    '__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS',
    '__EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES',
    '__EGL_VENDOR_LIBRARY_DIRS',
    '__EGL_VENDOR_LIBRARY_FILENAMES',
    'GBM_BACKEND',
    'GBM_BACKENDS_PATH',
    'LIBGL_DRIVERS_PATH',
    'MESA_LOADER_DRIVER_OVERRIDE',
    'LIBVA_DRIVER_NAME',
    'LIBVA_DRIVERS_PATH',
    'VDPAU_DRIVER_PATH',
    'VK_DRIVER_FILES',
    'VK_ICD_FILENAMES',
    'VK_ADD_DRIVER_FILES',
    'VK_ADD_LAYER_PATH',
    'VK_IMPLICIT_LAYER_PATH',
    'VK_ADD_IMPLICIT_LAYER_PATH',
    'VK_LAYER_PATH',
] as const;

function isPathInside(
    parentPath: string,
    candidatePath: string,
    allowEqual: boolean
): boolean {
    const relativePath = path.relative(parentPath, candidatePath);
    if (relativePath === '') {
        return allowEqual;
    }
    return (
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

function getTrustedSnapLibraryPaths(
    environment: NodeJS.ProcessEnv,
    snapRoot: string
): string[] {
    const snapLibraryPaths = getTrustedSnapHostGlLibraryPaths(environment);
    const graphicsLibraryRoot = path.join(
        snapRoot,
        SNAP_GRAPHICS_RUNTIME_DIRECTORY,
        'usr',
        'lib',
        SNAP_X64_LIBRARY_TRIPLET
    );
    const desktopLibraryPaths = getTrustedSnapDesktopLibraryPaths(
        environment,
        snapRoot
    );

    return [
        ...snapLibraryPaths,
        graphicsLibraryRoot,
        path.join(graphicsLibraryRoot, 'vdpau'),
        // The core22 libedit ABI must win over gnome-3-28's libtinfo5 build.
        TRUSTED_SNAP_BASE_LIBRARY_ROOT,
        ...desktopLibraryPaths,
        path.join(snapRoot, 'lib'),
        path.join(snapRoot, 'usr', 'lib'),
        path.join(snapRoot, 'lib', SNAP_X64_LIBRARY_TRIPLET),
        path.join(snapRoot, 'usr', 'lib', SNAP_X64_LIBRARY_TRIPLET),
    ];
}

function getTrustedSnapHostGlLibraryPaths(
    environment: NodeJS.ProcessEnv
): string[] {
    return (environment.SNAP_LIBRARY_PATH ?? '')
        .split(':')
        .filter(Boolean)
        .filter((libraryPath) => path.isAbsolute(libraryPath))
        .map((libraryPath) => path.resolve(libraryPath))
        .filter((libraryPath) =>
            isPathInside(TRUSTED_SNAP_GL_ROOT, libraryPath, true)
        );
}

function getTrustedSnapDesktopLibraryPaths(
    environment: NodeJS.ProcessEnv,
    snapRoot: string
): string[] {
    const desktopRuntime = resolveTrustedSnapDesktopRuntime(
        environment,
        snapRoot
    );
    if (!desktopRuntime) {
        return [];
    }

    const desktopLibraryRoot = path.join(
        desktopRuntime,
        'usr',
        'lib',
        SNAP_X64_LIBRARY_TRIPLET
    );
    return [
        path.join(desktopRuntime, 'lib', SNAP_X64_LIBRARY_TRIPLET),
        desktopLibraryRoot,
        path.join(desktopLibraryRoot, 'mesa'),
        path.join(desktopLibraryRoot, 'mesa-egl'),
        path.join(desktopLibraryRoot, 'dri'),
        path.join(desktopLibraryRoot, 'pulseaudio'),
    ];
}

function resolveTrustedSnapDesktopRuntime(
    environment: NodeJS.ProcessEnv,
    snapRoot: string
): string | null {
    const expectedDesktopRuntime = path.join(
        snapRoot,
        SNAP_DESKTOP_RUNTIME_DIRECTORY
    );
    const declaredDesktopRuntime = environment.SNAP_DESKTOP_RUNTIME;
    if (
        !declaredDesktopRuntime ||
        !path.isAbsolute(declaredDesktopRuntime) ||
        path.resolve(declaredDesktopRuntime) !== expectedDesktopRuntime
    ) {
        return null;
    }
    return expectedDesktopRuntime;
}

function isTrustedFlatpakRuntime(
    environment: NodeJS.ProcessEnv,
    nativeDir: string
): boolean {
    return (
        environment.FLATPAK_ID === TRUSTED_FLATPAK_APP_ID &&
        path.isAbsolute(nativeDir) &&
        isPathInside(TRUSTED_FLATPAK_APP_ROOT, path.resolve(nativeDir), false)
    );
}

function applyTrustedSnapGraphicsEnvironment(
    helperEnvironment: NodeJS.ProcessEnv,
    sourceEnvironment: NodeJS.ProcessEnv,
    snapRoot: string
): void {
    const graphicsRuntime = path.join(
        snapRoot,
        SNAP_GRAPHICS_RUNTIME_DIRECTORY,
        'usr'
    );
    const graphicsLibraryRoot = path.join(
        graphicsRuntime,
        'lib',
        SNAP_X64_LIBRARY_TRIPLET
    );
    const graphicsDriRoot = path.join(graphicsLibraryRoot, 'dri');

    helperEnvironment.GBM_BACKENDS_PATH = [
        path.join(graphicsLibraryRoot, 'gbm'),
        path.join(TRUSTED_SNAP_GL_ROOT, 'gbm'),
    ].join(':');
    helperEnvironment.LIBGL_DRIVERS_PATH = graphicsDriRoot;
    helperEnvironment.LIBVA_DRIVERS_PATH = graphicsDriRoot;
    helperEnvironment.__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS = path.join(
        graphicsRuntime,
        'share',
        'egl',
        'egl_external_platform.d'
    );
    helperEnvironment.__EGL_VENDOR_LIBRARY_DIRS = [
        TRUSTED_SNAP_EGL_VENDOR_ROOT,
        path.join(graphicsRuntime, 'share', 'glvnd', 'egl_vendor.d'),
    ].join(':');
    helperEnvironment.VK_LAYER_PATH = [
        path.join(graphicsRuntime, 'share', 'vulkan', 'implicit_layer.d'),
        path.join(graphicsRuntime, 'share', 'vulkan', 'explicit_layer.d'),
    ].join(':');

    const snapConfigRoot = path.join(snapRoot, 'etc', 'xdg');
    const snapDataRoot = path.join(snapRoot, 'usr', 'share');
    const desktopRuntime = resolveTrustedSnapDesktopRuntime(
        sourceEnvironment,
        snapRoot
    );
    const snapLibraryPaths =
        getTrustedSnapHostGlLibraryPaths(sourceEnvironment);
    if (snapLibraryPaths.length > 0) {
        helperEnvironment.SNAP_LIBRARY_PATH = snapLibraryPaths.join(':');
    } else {
        delete helperEnvironment.SNAP_LIBRARY_PATH;
    }
    helperEnvironment.SNAP_ARCH = 'amd64';
    helperEnvironment.SNAP_DESKTOP_ARCH_TRIPLET = SNAP_X64_LIBRARY_TRIPLET;
    if (desktopRuntime) {
        helperEnvironment.SNAP_DESKTOP_RUNTIME = desktopRuntime;
    } else {
        delete helperEnvironment.SNAP_DESKTOP_RUNTIME;
    }
    helperEnvironment.XDG_CONFIG_HOME = snapConfigRoot;
    helperEnvironment.XDG_CONFIG_DIRS = [snapConfigRoot, '/etc/xdg'].join(':');
    helperEnvironment.XDG_DATA_HOME = snapDataRoot;
    helperEnvironment.XDG_DATA_DIRS = [
        path.join(graphicsRuntime, 'share'),
        ...(desktopRuntime ? [path.join(desktopRuntime, 'usr', 'share')] : []),
        snapDataRoot,
        '/usr/share',
    ].join(':');
}

/**
 * Builds the loader environment shared by the bounded startup probe and each
 * real Linux helper session. The validated package profile is authoritative:
 * system packages use the system loader, while bundled packages start at
 * native/lib and add only fixed trusted Snap or Flatpak graphics roots.
 */
export function createLinuxFrameCopyHelperEnvironment(
    environment: NodeJS.ProcessEnv,
    nativeDir: string,
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode
): NodeJS.ProcessEnv {
    const helperEnvironment = { ...environment };
    for (const variableName of UNSAFE_HELPER_ENVIRONMENT_VARIABLES) {
        delete helperEnvironment[variableName];
    }
    for (const variableName of Object.keys(helperEnvironment)) {
        if (variableName.startsWith('BASH_FUNC_')) {
            delete helperEnvironment[variableName];
        }
    }

    if (runtimeMode === 'system') {
        return helperEnvironment;
    }

    const libraryPaths = [path.join(nativeDir, 'lib')];
    const trustedSnapRoot = resolveTrustedSnapRoot(environment, nativeDir);
    if (trustedSnapRoot) {
        helperEnvironment.PATH = TRUSTED_SNAP_HELPER_PATH;
        libraryPaths.push(
            ...getTrustedSnapLibraryPaths(environment, trustedSnapRoot)
        );
        applyTrustedSnapGraphicsEnvironment(
            helperEnvironment,
            environment,
            trustedSnapRoot
        );
    } else if (isTrustedFlatpakRuntime(environment, nativeDir)) {
        helperEnvironment.__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS =
            TRUSTED_FLATPAK_EGL_EXTERNAL_PLATFORM_CONFIG_DIRS;
    }
    helperEnvironment.LD_LIBRARY_PATH = [...new Set(libraryPaths)].join(':');
    return helperEnvironment;
}
