import { watchEmbeddedMpvSupport } from '@iptvnator/shared/interfaces';

let embeddedMpvPrepareScheduled = false;

export function scheduleEmbeddedMpvPrepare(): void {
    if (
        embeddedMpvPrepareScheduled ||
        typeof window === 'undefined' ||
        !window.electron?.prepareEmbeddedMpv
    ) {
        return;
    }

    embeddedMpvPrepareScheduled = true;
    const prepare = () => {
        void window.electron
            .prepareEmbeddedMpv?.()
            .then((support) => {
                if (!support?.supported) {
                    embeddedMpvPrepareScheduled = false;
                }
            })
            .catch((error) => {
                embeddedMpvPrepareScheduled = false;
                console.warn('Failed to prepare embedded MPV.', error);
            });
    };
    const idleWindow = window as typeof window & {
        requestIdleCallback?: (
            callback: IdleRequestCallback,
            options?: IdleRequestOptions
        ) => number;
    };

    if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(prepare, { timeout: 5000 });
    } else {
        window.setTimeout(prepare, 2000);
    }
}

/**
 * Checks a saved Embedded MPV selection against this machine: schedules the
 * idle prepare when it is supported, and calls `fallBack` when it is not or
 * when the check itself fails. An inconclusive answer is no verdict: the
 * selection stays and the answer is followed until it is final. Nothing is
 * done once `isSaved` turns false, because the user picked another player
 * meanwhile. Resolves when the first answer has been handled.
 */
export function verifySavedEmbeddedMpvPlayer(
    isSaved: () => boolean,
    fallBack: () => Promise<void>
): Promise<void> {
    const electron =
        typeof window === 'undefined' ? undefined : window.electron;
    if (!electron?.getEmbeddedMpvSupport) {
        return fallBack();
    }

    return new Promise<void>((handled, failed) => {
        const stop = watchEmbeddedMpvSupport(
            () => electron.getEmbeddedMpvSupport(),
            (support) => {
                if (!isSaved()) {
                    stop();
                    handled();
                } else if (support.supported) {
                    scheduleEmbeddedMpvPrepare();
                    handled();
                } else if (support.inconclusive) {
                    handled();
                } else {
                    fallBack().then(handled, failed);
                }
            },
            (error) => {
                console.warn(
                    'Failed to verify embedded MPV support; reverting to the default inline player.',
                    error
                );
                if (isSaved()) {
                    fallBack().then(handled, failed);
                } else {
                    handled();
                }
            }
        );
    });
}
