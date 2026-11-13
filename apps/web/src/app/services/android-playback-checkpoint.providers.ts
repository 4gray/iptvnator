import {
    DOCUMENT,
    EnvironmentInjector,
    inject,
    provideAppInitializer,
    runInInjectionContext,
} from '@angular/core';

export function provideAndroidPlaybackCheckpoint() {
    return provideAppInitializer(() => {
        const window = inject(DOCUMENT).defaultView as
            | (Window & { TvShell?: { postMessage(message: string): void } })
            | null;
        const shell = window?.TvShell;
        if (!window || !shell || typeof shell.postMessage !== 'function')
            return;

        // Register before the Android shell reports that the page is ready.
        const injector = inject(EnvironmentInjector);
        return import('./android-playback-checkpoint').then(
            ({ installAndroidPlaybackCheckpoint }) =>
                runInInjectionContext(injector, () =>
                    installAndroidPlaybackCheckpoint(window, shell)
                )
        );
    });
}
