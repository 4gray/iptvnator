export function exitOwnedPlayerFullscreen(
    enabled: boolean,
    playerRoot: HTMLElement | undefined,
    onFailure: (error: unknown) => void
): void {
    if (
        !enabled ||
        document.fullscreenElement !== playerRoot ||
        typeof document.exitFullscreen !== 'function'
    ) {
        return;
    }

    try {
        void Promise.resolve(document.exitFullscreen()).catch(onFailure);
    } catch (error: unknown) {
        onFailure(error);
    }
}
