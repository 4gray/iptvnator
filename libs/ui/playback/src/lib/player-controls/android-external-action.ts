import { InjectionToken, type Signal } from '@angular/core';

export interface AndroidExternalAction {
    readonly available: Signal<boolean>;
    open(): void;
}

export const ANDROID_EXTERNAL_ACTION =
    new InjectionToken<AndroidExternalAction>(
        'Android handheld external playback action'
    );
