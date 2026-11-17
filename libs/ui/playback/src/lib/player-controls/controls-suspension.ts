/** Host attribute that hands keyboard and chrome ownership to a surface. */
export const PLAYER_SUSPENDED_ATTRIBUTE = 'data-player-shortcuts-suspended';

/**
 * Calls `onSuspend` whenever an ancestor of `host` gains
 * `data-player-shortcuts-suspended` (the programme guide docking the player
 * as a mini player). The suspending surface owns the player's chrome from
 * then on, so an open popover must not survive it: below the roomy width the
 * settings sheet makes the controls bar `inert`, and with the sheet hidden by
 * the dock nothing could close it or reach play/pause.
 *
 * Returns the disposer. Without `MutationObserver` it does nothing.
 */
export function watchPlayerSuspension(
    host: HTMLElement,
    onSuspend: () => void
): () => void {
    const root = host.ownerDocument?.body;
    if (typeof MutationObserver === 'undefined' || !root) {
        return () => undefined;
    }
    const observer = new MutationObserver(() => {
        if (host.closest(`[${PLAYER_SUSPENDED_ATTRIBUTE}]`)) {
            onSuspend();
        }
    });
    observer.observe(root, {
        subtree: true,
        attributes: true,
        attributeFilter: [PLAYER_SUSPENDED_ATTRIBUTE],
    });
    return () => observer.disconnect();
}
