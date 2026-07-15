import { app } from 'electron';
import { accessSync, constants as fsConstants, statSync } from 'fs';
import path from 'path';

/**
 * Platform gate + helper discovery for the embedded MPV frame-copy engine,
 * shared by startup and the runtime service so sandbox and engine decisions
 * cannot drift. These helpers must remain callable before app.whenReady().
 */
export function isFrameCopyPlatformSupported(): boolean {
    return process.platform === 'darwin' && process.arch === 'arm64';
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
 * relax the renderer sandbox.
 */
export function resolveFrameCopyHelperPath(): string | null {
    // Packaged startup must never fall through to cwd/dist development
    // artifacts: doing so would let a writable launch directory supply the
    // executable that causes BrowserWindow sandbox relaxation.
    const addonCandidates = app.isPackaged
        ? getPackagedAddonPaths()
        : [getLocalBuildAddonPath(), ...getDistAddonPaths()];

    return (
        addonCandidates
            .map((candidatePath) => path.dirname(candidatePath))
            .map((nativeDir) => ({
                helper: path.join(nativeDir, 'iptvnator_mpv_helper'),
                reader: path.join(
                    nativeDir,
                    'embedded_mpv_frame_reader.node'
                ),
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

export function isFrameCopyRuntimeUsable(
    resolveHelper: () => string | null = resolveFrameCopyHelperPath
): boolean {
    return isFrameCopyPlatformSupported() && resolveHelper() !== null;
}

export function shouldPromotePersistedFrameCopyOptIn(
    storedEnabled: boolean,
    explicitEnv: string | undefined,
    runtimeUsable = isFrameCopyRuntimeUsable()
): boolean {
    return explicitEnv === undefined && storedEnabled && runtimeUsable;
}
