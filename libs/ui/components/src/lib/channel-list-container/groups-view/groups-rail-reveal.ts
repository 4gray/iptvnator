import { createScrollPositionPreserver } from '../../scroll-position/create-scroll-position-preserver';
import { afterRenderEffect, DestroyRef, inject } from '@angular/core';

/**
 * Keeps the selected group in view, but only when it is not already: a plain
 * effect can read the DOM before the new selection has rendered (so it
 * centres the PREVIOUS group), and centring a group the user just clicked —
 * already fully visible — yanks the rail away from the groups around it.
 * Reads the row after the render instead, and leaves a fully visible row
 * where it is. Must be called in an injection context (a component
 * constructor), like the effects it installs.
 */
export function createGroupsRailReveal(params: {
    host: HTMLElement;
    selectedGroupKey: () => string | null;
    rowsChanged: () => unknown;
}): void {
    const scrollPosition = createScrollPositionPreserver(inject(DestroyRef));
    let revealedGroupKey: string | null = null;

    afterRenderEffect(() => {
        const selectedGroupKey = params.selectedGroupKey();
        // Track the rows too: while they are still rendering there is no
        // selected row to reveal, and their arrival must retry.
        params.rowsChanged();
        if (selectedGroupKey == null) {
            scrollPosition.cancel();
            // A cleared selection must not leave its reveal behind: when
            // the same group is selected again (e.g. a search that matched
            // nothing is cleared) it is revealed afresh.
            revealedGroupKey = null;
            return;
        }
        if (selectedGroupKey === revealedGroupKey) {
            return;
        }
        scrollPosition.cancel();

        const container = params.host.querySelector(
            '.groups-nav-list'
        ) as HTMLElement | null;
        const candidates = Array.from(
            params.host.querySelectorAll('[data-group-key]')
        ) as HTMLElement[];
        const selected =
            candidates.find(
                (candidate) =>
                    candidate.dataset['groupKey'] === selectedGroupKey
            ) ?? null;

        if (!container || !selected) {
            return;
        }

        revealedGroupKey = selectedGroupKey;

        const containerRect = container.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        if (
            selectedRect.top >= containerRect.top &&
            selectedRect.bottom <= containerRect.bottom
        ) {
            // Fully visible — but an earlier reveal may still be
            // smooth-scrolling towards the previous selection; stop it
            // here so it cannot carry this row out of view.
            scrollPosition.preserve(container);
            return;
        }

        const targetTop =
            container.scrollTop +
            (selectedRect.top - containerRect.top) -
            container.clientHeight / 2 +
            selectedRect.height / 2;
        const maxScrollTop = Math.max(
            0,
            container.scrollHeight - container.clientHeight
        );

        container.scrollTo({
            behavior: 'smooth',
            top: Math.min(maxScrollTop, Math.max(0, targetTop)),
        });
    });
}
