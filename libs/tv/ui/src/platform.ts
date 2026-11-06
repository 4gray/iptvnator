import { detectTvPlatform, tvMediaKeys } from '@iptvnator/tv/util';

interface TvWindow {
    webapis?: {
        appcommon?: {
            AppCommonScreenSaverState: {
                SCREEN_SAVER_ON: number;
                SCREEN_SAVER_OFF: number;
            };
            setScreenSaver: (
                state: number,
                success: () => void,
                error: () => void
            ) => void;
        };
    };
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

/** The platform SDK is loaded only by the staged Samsung package. */
export function installTvScreensaver(video: HTMLVideoElement) {
    const common = tvWindow().webapis?.appcommon;
    if (!common?.setScreenSaver) return () => undefined;
    const document = video.ownerDocument;
    const warn = () => console.warn('TV screensaver update failed.');
    const set = (enabled: boolean) => {
        try {
            common.setScreenSaver(
                enabled
                    ? common.AppCommonScreenSaverState.SCREEN_SAVER_ON
                    : common.AppCommonScreenSaverState.SCREEN_SAVER_OFF,
                () => undefined,
                warn
            );
        } catch {
            warn();
        }
    };
    const sync = () =>
        set(document.hidden || video.paused || video.ended || !!video.error);
    const release = () => set(true);
    const events = ['playing', 'pause', 'ended', 'error', 'emptied'];
    for (const name of events) video.addEventListener(name, sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', release);
    sync();
    return () => {
        for (const name of events) video.removeEventListener(name, sync);
        document.removeEventListener('visibilitychange', sync);
        window.removeEventListener('pagehide', release);
        release();
    };
}
