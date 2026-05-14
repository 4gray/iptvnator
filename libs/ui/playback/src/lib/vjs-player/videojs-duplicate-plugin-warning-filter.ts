import videoJs from 'video.js';

type VideoJsWithLoggerPatch = typeof videoJs & {
    getPlugin?: (name: string) => unknown;
    log?: {
        warn?: PatchedWarn;
    };
    registerPlugin?: PatchedRegisterPlugin;
};

type PatchedWarn = ((...args: unknown[]) => void) & {
    __iptvnatorDuplicatePluginWarningPatched?: boolean;
};

type PatchedRegisterPlugin = ((name: string, plugin: unknown) => unknown) & {
    __iptvnatorDuplicatePluginWarningPatched?: boolean;
};

const vjs = videoJs as VideoJsWithLoggerPatch | undefined;
const warn = vjs?.log?.warn;
const registerPlugin = vjs?.registerPlugin?.bind(vjs);
const consoleWarn = console.warn as PatchedWarn;

function isDuplicateQualityLevelsWarning(args: readonly unknown[]): boolean {
    return args
        .map((arg) => String(arg))
        .join(' ')
        .toLowerCase()
        .includes('plugin named "qualitylevels" already exists');
}

if (vjs && warn && !warn.__iptvnatorDuplicatePluginWarningPatched) {
    const patchedWarn: PatchedWarn = (...args: unknown[]) => {
        if (isDuplicateQualityLevelsWarning(args)) {
            return;
        }

        warn(...args);
    };
    patchedWarn.__iptvnatorDuplicatePluginWarningPatched = true;
    vjs.log!.warn = patchedWarn;
}

if (
    vjs &&
    registerPlugin &&
    !vjs.registerPlugin?.__iptvnatorDuplicatePluginWarningPatched
) {
    const patchedRegisterPlugin: PatchedRegisterPlugin = (
        name: string,
        plugin: unknown
    ) => {
        if (name === 'qualityLevels' && vjs.getPlugin?.(name)) {
            return vjs.getPlugin(name);
        }

        return registerPlugin(name, plugin);
    };
    patchedRegisterPlugin.__iptvnatorDuplicatePluginWarningPatched = true;
    (
        vjs as unknown as {
            registerPlugin: PatchedRegisterPlugin;
        }
    ).registerPlugin = patchedRegisterPlugin;
}

if (!consoleWarn.__iptvnatorDuplicatePluginWarningPatched) {
    const patchedConsoleWarn: PatchedWarn = (...args: unknown[]) => {
        if (isDuplicateQualityLevelsWarning(args)) {
            return;
        }

        consoleWarn(...args);
    };
    patchedConsoleWarn.__iptvnatorDuplicatePluginWarningPatched = true;
    console.warn = patchedConsoleWarn;
}
