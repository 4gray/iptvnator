const selectors =
    'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[data-tv-scroll]';
export function focusKey() {
    return (document.activeElement as HTMLElement)?.dataset.focus ?? '';
}
export function restoreFocus(
    key: string,
    fallback = '',
    scroll?: number,
    owns: () => boolean = () => true
) {
    requestAnimationFrame(() => {
        if (!owns()) return;
        const elements = Array.from(
            (
                document.querySelector('[data-tv-modal]') ?? document
            ).querySelectorAll<HTMLElement>(selectors)
        ).filter((e) => !!e.offsetWidth && !e.closest('[hidden]'));
        const target =
            elements.find((e) => e.dataset.focus === key) ??
            elements.find((e) => e.dataset.focus === fallback) ??
            elements[0];
        target?.focus();
        if (scroll !== undefined) {
            const main = document.querySelector('main');
            if (main) main.scrollTop = scroll;
        }
    });
}
export function installRemote(
    back: () => void,
    fullscreen: () => boolean,
    playerKey: (key: number) => void
) {
    let lastMove = 0;
    const handler = (event: KeyboardEvent) => {
        const code = event.keyCode;
        const direction =
            (
                {
                    37: 'ArrowLeft',
                    38: 'ArrowUp',
                    39: 'ArrowRight',
                    40: 'ArrowDown',
                } as Record<number, string>
            )[code] ?? event.key;
        if (
            code === 461 ||
            event.key === 'Escape' ||
            event.key === 'BrowserBack' ||
            (event.key === 'Backspace' &&
                !(event.target instanceof HTMLInputElement))
        ) {
            event.preventDefault();
            back();
            return;
        }
        if ([415, 19, 413, 412, 417].includes(code)) {
            event.preventDefault();
            playerKey(code);
            return;
        }
        if (!direction.startsWith('Arrow')) return;
        const from = document.activeElement as HTMLElement;
        const horizontal = /Left|Right/.test(direction);
        // Keep caret/slider movement native; vertical arrows leave single-line
        // fields. Selects own vertical choice changes and leave horizontally.
        if (
            from?.matches('textarea') ||
            (horizontal &&
                from?.matches(
                    'input:not([type="checkbox"]):not([type="radio"])'
                )) ||
            (!horizontal && from?.matches('select'))
        )
            return;
        event.preventDefault();
        if (event.repeat && Date.now() - lastMove < 75) return;
        lastMove = Date.now();
        const root =
            document.querySelector('[data-tv-modal]') ??
            (fullscreen()
                ? document.querySelector('.player-controls')
                : document);
        const candidates = Array.from(
            root?.querySelectorAll<HTMLElement>(selectors) ?? []
        ).filter(
            (e) =>
                e !== from &&
                !!e.offsetWidth &&
                !!e.offsetHeight &&
                !e.closest('[hidden]')
        );
        if (!from || from === document.body || !from.offsetWidth) {
            candidates[0]?.focus();
            return;
        }
        const rect = from.getBoundingClientRect();
        const sign = /Left|Up/.test(direction) ? -1 : 1;
        let score = Infinity;
        let target: HTMLElement | undefined;
        for (const element of candidates) {
            const r = element.getBoundingClientRect();
            const x = r.left + r.width / 2 - rect.left - rect.width / 2;
            const y = r.top + r.height / 2 - rect.top - rect.height / 2;
            const primary = horizontal ? x : y;
            const secondary = horizontal ? y : x;
            if (primary * sign <= 3) continue;
            const distance = Math.abs(primary) + Math.abs(secondary) * 3;
            if (distance < score) {
                score = distance;
                target = element;
            }
        }
        target?.focus();
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
export function platformBack() {
    const platform = window as unknown as {
        webOS?: { platformBack?: () => void };
        PalmSystem?: { platformBack?: () => void };
    };
    if (platform.webOS?.platformBack) platform.webOS.platformBack();
    else platform.PalmSystem?.platformBack?.();
}
