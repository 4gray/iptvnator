import { detectTvPlatform, tvMediaKeys } from '@iptvnator/tv/util';

interface TvWindow {
    tizen?: {
        tvinputdevice?: { registerKey: (name: string) => void };
        application?: {
            getCurrentApplication: () => {
                exit: () => void;
                appInfo?: { id: string };
            };
        };
    };
    webOS?: { platformBack?: () => void };
    PalmSystem?: { platformBack?: () => void };
}
const tvWindow = () => window as unknown as TvWindow;

export function currentTvPlatform() {
    return detectTvPlatform(navigator.userAgent, !!tvWindow().tizen);
}

export function tvApplicationId(fallback: string) {
    return (
        tvWindow().tizen?.application?.getCurrentApplication().appInfo?.id ??
        fallback
    );
}

/** Unsupported keys must not prevent basic arrows/OK/Back or later media keys. */
export function registerTvKeys() {
    const device = tvWindow().tizen?.tvinputdevice;
    if (!device) return;
    for (const key of tvMediaKeys) {
        try {
            device.registerKey(key.name);
        } catch {
            // Only static key names are reported; platform exception text can contain device data.
            console.warn('TV remote key registration failed: ' + key.name);
        }
    }
}

export function platformBack() {
    const platform = tvWindow();
    if (platform.tizen?.application)
        platform.tizen.application.getCurrentApplication().exit();
    else if (platform.webOS?.platformBack) platform.webOS.platformBack();
    else platform.PalmSystem?.platformBack?.();
}
