import { clearNavigationStateKeys } from '@iptvnator/portal/shared/util';

const STATE_KEY = 'catalogReturnFocus';

/** The list's history entry owns its focus anchor, including inline Stalker details. */
export function createCatalogReturnFocus(host: HTMLElement) {
    let returnTrigger: Element | null | undefined;
    const read = (): string | null => {
        const saved = window.history.state?.[STATE_KEY];
        return saved?.url === window.location.href &&
            typeof saved.key === 'string'
            ? saved.key
            : null;
    };
    return {
        pending: () => read() !== null,
        recordReturnTrigger(): void {
            if (returnTrigger === undefined && read() !== null) {
                returnTrigger =
                    document.activeElement?.closest(
                        '[data-test-id="workspace-header-back"]'
                    ) ?? null;
            }
        },
        capture(): void {
            returnTrigger = undefined;
            const card = document.activeElement?.closest<HTMLElement>(
                '[data-catalog-focus-key]'
            );
            if (
                !card ||
                !host.contains(card) ||
                !card.dataset['catalogFocusKey']
            )
                return;
            try {
                window.history.replaceState(
                    {
                        ...window.history.state,
                        [STATE_KEY]: {
                            url: window.location.href,
                            key: card.dataset['catalogFocusKey'],
                        },
                    },
                    document.title
                );
            } catch {
                // A refused history write must never prevent opening the detail.
            }
        },
        restore(): void {
            const key = read();
            if (key === null || !host.isConnected) return;
            clearNavigationStateKeys([STATE_KEY]);
            const active = document.activeElement;
            const main = host.closest<HTMLElement>('main');
            if (
                (active !== document.body &&
                    active !== main &&
                    active !== returnTrigger) ||
                host.closest('[inert]')
            )
                return;
            const card = Array.from(
                host.querySelectorAll<HTMLElement>('[data-catalog-focus-key]')
            ).find((item) => item.dataset['catalogFocusKey'] === key);
            (card ?? main)?.focus({ preventScroll: true });
        },
    };
}
