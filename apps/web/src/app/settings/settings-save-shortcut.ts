export function isSettingsSaveShortcut(
    event: KeyboardEvent,
    host: HTMLElement
): boolean {
    return (
        !event.defaultPrevented &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 's' &&
        !host.closest('[inert]') &&
        !host.ownerDocument.querySelector('.cdk-overlay-backdrop')
    );
}
