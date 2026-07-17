import { app } from 'electron';
import { accessSync, constants as fsConstants, statSync } from 'fs';
import path from 'path';
import { probeEmbeddedMpvFrameCopyRuntime } from './embedded-mpv-frame-copy-runtime';
import type { EmbeddedMpvFrameCopyRuntimeResult } from './embedded-mpv-frame-copy-runtime';

/**
 * Platform gate + helper discovery for the embedded MPV frame-copy engine,
 * shared by startup, the runtime service, and the frame-copy adapter so
 * sandbox and engine decisions cannot drift. These helpers must remain
 * callable before app.whenReady().
 *
 * macOS: Apple Silicon only (owner decision 2026-07-10) — Intel Macs keep
 * the docked native engine. Linux: x64 only — official packages validate a
 * profile manifest and run the helper's bounded EGL/libmpv capability probe;
 * ARM packages remain honestly unavailable. Windows: any arch with a helper
 * binary (WGL offscreen render; in practice x64, the only vendored runtime)
 * — the helper-presence check below is the real gate.
 */
export function isFrameCopyPlatformSupported(): boolean {
    return (
        (process.platform === 'linux' && process.arch === 'x64') ||
        process.platform === 'win32' ||
        (process.platform === 'darwin' && process.arch === 'arm64')
    );
}

function dedupeDefinedPaths(paths: Array<string | undefined>): string[] {
    return [
        ...new Set(paths.filter((value): value is string => Boolean(value))),
    ];
}

function getLocalBuildAddonPath(): string {
    return path.resolve(
        process.cwd(),
        'apps/electron-backend/native/build/Release/embedded_mpv.node'
    );
}

function getDistAddonPaths(): string[] {
    return [
        path.resolve(__dirname, 'native/embedded_mpv.node'),
        path.resolve(__dirname, '../../native/embedded_mpv.node'),
    ];
}

function getPackagedAddonPaths(): string[] {
    const resourcesPath = (
        process as NodeJS.Process & { resourcesPath?: string }
    ).resourcesPath;
    return dedupeDefinedPaths([
        resourcesPath
            ? path.resolve(
                  resourcesPath,
                  'app.asar.unpacked',
                  'electron-backend',
                  'native',
                  'embedded_mpv.node'
              )
            : undefined,
        app.getAppPath()
            ? path.join(
                  path.dirname(app.getAppPath()),
                  'app.asar.unpacked',
                  'electron-backend',
                  'native',
                  'embedded_mpv.node'
              )
            : undefined,
    ]);
}

/** Candidate locations of the embedded MPV addon, most likely first. */
export function getEmbeddedMpvAddonCandidatePaths(): string[] {
    const localBuildAddonPath = getLocalBuildAddonPath();
    const distAddonPaths = getDistAddonPaths();
    const packagedAddonPaths = getPackagedAddonPaths();

    return dedupeDefinedPaths(
        app.isPackaged
            ? [...packagedAddonPaths, ...distAddonPaths, localBuildAddonPath]
            : [localBuildAddonPath, ...distAddonPaths, ...packagedAddonPaths]
    );
}

/**
 * Resolve the first executable frame-copy helper with a readable regular-file
 * frame reader beside it. Both artifacts are required before the engine may
 * relax the renderer sandbox. Windows uses the `.exe` helper name; X_OK is an
 * existence check there, while POSIX platforms also require the execute bit.
 */
export function resolveFrameCopyHelperPath(): string | null {
    // Packaged startup must never fall through to cwd/dist development
    // artifacts: doing so would let a writable launch directory supply the
    // executable that causes BrowserWindow sandbox relaxation.
    const addonCandidates = app.isPackaged
        ? getPackagedAddonPaths()
        : [getLocalBuildAddonPath(), ...getDistAddonPaths()];
    const helperFileName =
        process.platform === 'win32'
            ? 'iptvnator_mpv_helper.exe'
            : 'iptvnator_mpv_helper';
    return (
        addonCandidates
            .map((candidatePath) => path.dirname(candidatePath))
            .map((nativeDir) => ({
                helper: path.join(nativeDir, helperFileName),
                reader: path.join(nativeDir, 'embedded_mpv_frame_reader.node'),
            }))
            .find(({ helper, reader }) => {
                try {
                    accessSync(helper, fsConstants.X_OK);
                    accessSync(reader, fsConstants.R_OK);
                    if (
                        !statSync(helper).isFile() ||
                        !statSync(reader).isFile()
                    ) {
                        return false;
                    }
                    return true;
                } catch {
                    return false;
                }
            })?.helper ?? null
    );
}

type FrameCopyRuntimeProbe = (
    helperPath: string
) => EmbeddedMpvFrameCopyRuntimeResult;

export type FrameCopyRuntimeAvailability =
    | EmbeddedMpvFrameCopyRuntimeResult
    | { usable: true };

let cachedDefaultRuntimeAvailability: FrameCopyRuntimeAvailability | undefined;

export function getFrameCopyRuntimeAvailability(
    resolveHelper: () => string | null = resolveFrameCopyHelperPath,
    probeRuntime: FrameCopyRuntimeProbe = probeEmbeddedMpvFrameCopyRuntime
): FrameCopyRuntimeAvailability {
    const usesProcessDecision =
        resolveHelper === resolveFrameCopyHelperPath &&
        probeRuntime === probeEmbeddedMpvFrameCopyRuntime;
    if (usesProcessDecision && cachedDefaultRuntimeAvailability !== undefined) {
        return cachedDefaultRuntimeAvailability;
    }

    let availability: FrameCopyRuntimeAvailability;
    if (!isFrameCopyPlatformSupported()) {
        availability = {
            usable: false,
            reason:
                process.platform === 'linux'
                    ? 'unsupported-architecture'
                    : 'unsupported-platform',
        };
    } else {
        const helperPath = resolveHelper();
        if (!helperPath) {
            availability = {
                usable: false,
                reason: 'runtime-artifact-missing',
            };
        } else if (process.platform !== 'linux') {
            availability = { usable: true };
        } else {
            try {
                availability = probeRuntime(helperPath);
            } catch {
                availability = {
                    usable: false,
                    reason: 'runtime-probe-internal-error',
                };
            }
        }
    }
    if (usesProcessDecision) {
        cachedDefaultRuntimeAvailability = availability;
    }
    return availability;
}

export function isFrameCopyRuntimeUsable(
    resolveHelper: () => string | null = resolveFrameCopyHelperPath,
    probeRuntime: FrameCopyRuntimeProbe = probeEmbeddedMpvFrameCopyRuntime
): boolean {
    return getFrameCopyRuntimeAvailability(resolveHelper, probeRuntime).usable;
}

export function shouldPromotePersistedFrameCopyOptIn(
    storedEnabled: boolean,
    explicitEnv: string | undefined,
    runtimeUsable = isFrameCopyRuntimeUsable()
): boolean {
    return explicitEnv === undefined && storedEnabled && runtimeUsable;
}
