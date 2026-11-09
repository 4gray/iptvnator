export type TvPlatform = 'webos' | 'tizen' | 'browser';

export function detectTvPlatform(
    userAgent: string,
    hasTizen: boolean
): TvPlatform {
    if (hasTizen || /\bTizen\b/i.test(userAgent)) return 'tizen';
    if (/web0s|webos|netcast/i.test(userAgent)) return 'webos';
    return 'browser';
}

export const tvPlatformLabels: Record<TvPlatform, string> = {
    webos: 'webOS TV',
    tizen: 'Samsung Tizen TV',
    browser: 'Web browser',
};

export const tvBackCodes = { webos: 461, tizen: 10009 } as const;

/** Editing controls decide locally whether Backspace belongs to text entry. */
export function isBackKey(event: { key: string; keyCode: number }): boolean {
    return (
        event.keyCode === tvBackCodes.webos ||
        event.keyCode === tvBackCodes.tizen ||
        ['Escape', 'BrowserBack', 'Backspace'].includes(event.key)
    );
}

const textFieldSelector =
    'textarea,input:not([type="checkbox"]):not([type="radio"])';

/** The element is a text field accepting input right now (not read-only). */
export function editingText(target: Element | null): boolean {
    return (
        !!target?.matches?.(textFieldSelector) &&
        !(target as HTMLInputElement).readOnly
    );
}

/** The element is a textarea accepting input right now (not read-only). */
export function editingTextarea(target: Element | null): boolean {
    return (
        !!target?.matches?.('textarea') &&
        !(target as HTMLTextAreaElement).readOnly
    );
}

/** Backspace deletes text only while the target field is editable. */
export function backspaceEdits(event: {
    key: string;
    target: EventTarget | null;
}): boolean {
    return event.key === 'Backspace' && editingText(event.target as Element);
}

export const tvMediaKeys = [
    { name: 'MediaPlay', code: 415, action: 'play' },
    { name: 'MediaPause', code: 19, action: 'pause' },
    { name: 'MediaStop', code: 413, action: 'stop' },
    { name: 'MediaRewind', code: 412, action: 'rewind' },
    { name: 'MediaFastForward', code: 417, action: 'forward' },
    { name: 'MediaPlayPause', code: 10252, action: 'toggle' },
] as const;
export type TvMediaAction = (typeof tvMediaKeys)[number]['action'];
export const mediaKeyAction = (code: number): TvMediaAction | undefined =>
    tvMediaKeys.find((key) => key.code === code)?.action;
