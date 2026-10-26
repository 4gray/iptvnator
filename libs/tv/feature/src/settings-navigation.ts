import { useEffect, useRef, useState } from 'preact/hooks';
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
    const enter = () => {
        const controls = Array.from(
            panel()?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary'
            ) ?? []
        ).filter((element) => !!element.offsetHeight);
        (
            controls.find(
                (element) =>
                    element.dataset.focus === memory.controls[memory.category]
            ) ??
            controls[0] ??
            panel()
        )?.focus();
    };
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const target = Array.from(
                root.current?.querySelectorAll<HTMLElement>('[data-focus]') ??
                    []
            ).find(
                (element) =>
                    element.dataset.focus === memory.focus &&
                    !!element.offsetHeight
            );
            (target ?? categoryButton())?.focus();
            if (panel())
                panel()!.scrollTop = memory.scroll[memory.category] ?? 0;
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
