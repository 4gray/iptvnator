import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

export const settingsCategories = [
    ['connection', 'Connection', 'Home server & diagnostics'],
    ['library', 'Library & sync', 'Shared sources'],
    ['appearance', 'Appearance', 'Home composition'],
    ['epg', 'Programme guide', 'Provider schedules'],
    ['metadata', 'Metadata · TMDB', 'Artwork & descriptions'],
    ['remote', 'Your remote', 'Buttons & navigation'],
] as const;
export type SettingsCategory = (typeof settingsCategories)[number][0];
export interface SettingsMemory {
    category: SettingsCategory;
    focus?: string;
    controls: Partial<Record<SettingsCategory, string>>;
    scroll: Partial<Record<SettingsCategory, number>>;
}
// Closed <details> descendants can report dimensions in Chromium while native
// focus still refuses them. Keep entry, restoration and panel moves consistent.
function available(element: HTMLElement): boolean {
    if (
        element.matches(':disabled') ||
        !element.offsetHeight ||
        !element.getClientRects().length ||
        element.closest('[hidden]')
    )
        return false;
    let closed = element.closest<HTMLDetailsElement>('details:not([open])');
    while (closed) {
        if (!closed.querySelector('summary')?.contains(element)) return false;
        closed =
            closed.parentElement?.closest<HTMLDetailsElement>(
                'details:not([open])'
            ) ?? null;
    }
    return true;
}

export function useSettingsNavigation(memory: SettingsMemory) {
    const [category, setCategory] = useState(memory.category);
    const root = useRef<HTMLDivElement>(null);
    const categoryButton = () =>
        root.current?.querySelector<HTMLElement>(
            `[data-focus="settings:${memory.category}"]`
        );
    const panel = () =>
        root.current?.querySelector<HTMLElement>(
            `#settings-panel-${memory.category}`
        );
    const controls = () =>
        Array.from(
            panel()?.querySelectorAll<HTMLElement>(
                'button,input,select,textarea,summary'
            ) ?? []
        ).filter(available);
    const enter = () => {
        const candidates = controls();
        (
            candidates.find(
                (element) =>
                    element.dataset.focus === memory.controls[memory.category]
            ) ??
            candidates[0] ??
            panel()
        )?.focus();
    };
    useLayoutEffect(() => {
        if (panel()) panel()!.scrollTop = memory.scroll[category] ?? 0;
    }, [category, memory]);
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const target = Array.from(
                root.current?.querySelectorAll<HTMLElement>('[data-focus]') ??
                    []
            ).find(
                (element) =>
                    element.dataset.focus === memory.focus && available(element)
            );
            (target ?? categoryButton())?.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [memory]);
    const select = (next: SettingsCategory) => {
        memory.category = next;
        setCategory(next);
    };
    const onFocus: JSX.FocusEventHandler<HTMLDivElement> = (event) => {
        const target = event.target as HTMLElement;
        memory.focus = target.dataset.focus;
        if (target.closest('[data-settings-panel]') && target.dataset.focus)
            memory.controls[memory.category] = target.dataset.focus;
    };
    const onKeyDown: JSX.KeyboardEventHandler<HTMLDivElement> = (event) => {
        const target = event.target as HTMLElement;
        const key =
            (
                {
                    13: 'Enter',
                    37: 'ArrowLeft',
                    38: 'ArrowUp',
                    39: 'ArrowRight',
                    40: 'ArrowDown',
                    461: 'Escape',
                } as Record<number, string>
            )[event.keyCode] ?? event.key;
        const inPanel = !!target.closest('[data-settings-panel]');
        const back =
            key === 'Escape' ||
            key === 'BrowserBack' ||
            (key === 'Backspace' && !target.matches('input,textarea'));
        // Text inputs retain horizontal caret movement. Native selects leave
        // horizontally, as in the shared remote engine.
        if (
            inPanel &&
            (back ||
                (key === 'ArrowLeft' &&
                    !target.matches(
                        'textarea,input:not([type="checkbox"]):not([type="radio"])'
                    )))
        ) {
            event.preventDefault();
            event.stopPropagation();
            categoryButton()?.focus();
        } else if (
            inPanel &&
            key === 'Enter' &&
            target.matches('input[type="checkbox"]')
        ) {
            event.preventDefault();
            event.stopPropagation();
            target.click();
        } else if (
            inPanel &&
            ['ArrowUp', 'ArrowDown', 'ArrowRight'].includes(key)
        ) {
            // Selects own choice keys and text inputs own the caret. All other
            // moves stay in this form rather than crossing into the categories.
            if (
                (target.matches('select,textarea') && key !== 'ArrowRight') ||
                (key === 'ArrowRight' &&
                    target.matches(
                        'textarea,input:not([type="checkbox"]):not([type="radio"])'
                    ))
            )
                return;
            event.preventDefault();
            event.stopPropagation();
            const candidates = controls();
            const index = candidates.indexOf(target);
            const next = candidates[index + (key === 'ArrowUp' ? -1 : 1)];
            if (next) {
                next.focus();
                next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } else if (key === 'ArrowUp' || key === 'ArrowDown') {
                const owner = panel();
                const before = owner?.scrollTop ?? 0;
                if (owner)
                    owner.scrollTop +=
                        ((key === 'ArrowUp' ? -1 : 1) * owner.clientHeight) / 2;
                if (owner && owner.scrollTop !== before) return;
                if (key !== 'ArrowUp' || index > 0) return;
                const phone = root.current?.querySelector<HTMLElement>(
                    '[data-focus="phone-start"]'
                );
                (phone && available(phone) ? phone : categoryButton())?.focus();
            }
        } else if (
            target.closest('.settings-categories') &&
            (key === 'ArrowUp' || key === 'ArrowDown')
        ) {
            event.preventDefault();
            event.stopPropagation();
            const index = settingsCategories.findIndex(
                ([id]) => id === memory.category
            );
            const next =
                settingsCategories[index + (key === 'ArrowUp' ? -1 : 1)];
            if (next)
                root.current
                    ?.querySelector<HTMLElement>(
                        `[data-focus="settings:${next[0]}"]`
                    )
                    ?.focus();
        } else if (
            target.closest('.settings-categories') &&
            (key === 'ArrowRight' || key === 'Enter')
        ) {
            event.preventDefault();
            event.stopPropagation();
            enter();
        }
    };
    return { root, category, select, onFocus, onKeyDown };
}
