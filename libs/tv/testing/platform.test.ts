import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    detectTvPlatform,
    isBackKey,
    mediaKeyAction,
    tvPlatformLabels,
    type TvMediaAction,
} from '@iptvnator/tv/util';
import {
    backspaceEdits,
    currentTvPlatform,
    editingText,
    installImeGuard,
    installRemote,
    platformBack,
    registerTvKeys,
    tvApplicationId,
} from '@iptvnator/tv/ui';

for (const [agent, bridge, expected] of [
    ['Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/68.0', false, 'webos'],
    ['webOS', false, 'webos'],
    ['NETCAST', false, 'webos'],
    [
        'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) TV Safari/537.36',
        false,
        'tizen',
    ],
    ['Mozilla/5.0 Chrome/69.0', true, 'tizen'],
    ['Mozilla/5.0 Chrome/130.0', false, 'browser'],
] as const) {
    test(
        'platform detection: ' +
            expected +
            ' from ' +
            agent +
            ' / bridge=' +
            bridge,
        () => {
            assert.equal(detectTvPlatform(agent, bridge), expected);
        }
    );
}

function browser(t: TestContext) {
    const dom = new JSDOM('<button>Start</button><input>');
    const previous = {
        window: globalThis.window,
        document: globalThis.document,
        HTMLInputElement: globalThis.HTMLInputElement,
    };
    Object.assign(globalThis, {
        window: dom.window,
        document: dom.window.document,
        HTMLInputElement: dom.window.HTMLInputElement,
    });
    t.after(() => {
        dom.window.close();
        Object.assign(globalThis, previous);
    });
    return dom;
}

test('both remote Back codes and browser aliases reach navigation; text Backspace remains native', (t) => {
    const dom = browser(t);
    let backs = 0;
    const actions: TvMediaAction[] = [];
    const remove = installRemote(
        () => backs++,
        () => false,
        (action) => actions.push(action)
    );
    for (const [key, keyCode] of [
        ['Unidentified', 461],
        ['Unidentified', 10009],
        ['Escape', 0],
        ['BrowserBack', 0],
        ['Backspace', 8],
    ] as const) {
        const event = new dom.window.KeyboardEvent('keydown', {
            key,
            keyCode,
            bubbles: true,
            cancelable: true,
        });
        dom.window.document.querySelector('button')!.dispatchEvent(event);
        assert.equal(isBackKey(event), true);
        assert.equal(event.defaultPrevented, true);
    }
    assert.equal(backs, 5);
    const typing = new dom.window.KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
    });
    dom.window.document.querySelector('input')!.dispatchEvent(typing);
    assert.equal(typing.defaultPrevented, false);
    assert.equal(backs, 5);
    for (const [code, expected] of [
        [415, 'play'],
        [19, 'pause'],
        [413, 'stop'],
        [412, 'rewind'],
        [417, 'forward'],
        [10252, 'toggle'],
    ] as const) {
        dom.window.document.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', {
                keyCode: code,
                cancelable: true,
            })
        );
        assert.equal(actions.pop(), expected);
        assert.equal(mediaKeyAction(code), expected);
    }
    assert.equal(mediaKeyAction(13), undefined);
    assert.equal(isBackKey({ key: 'Enter', keyCode: 13 }), false);
    remove();
    dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { keyCode: 10009 })
    );
    assert.equal(backs, 5, 'cleanup removes navigation listener');
});

test('IME guard keeps focus read-only until Enter or click starts editing', (t) => {
    const dom = browser(t);
    const remove = installImeGuard();
    const input = dom.window.document.querySelector(
        'input'
    ) as HTMLInputElement;
    input.focus();
    assert.equal(input.readOnly, true, 'focus alone must not edit');
    const enter = new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        bubbles: true,
        cancelable: true,
    });
    input.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(input.readOnly, false, 'explicit OK starts editing');
    assert.equal(dom.window.document.activeElement, input);
    const submit = new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 13,
        bubbles: true,
        cancelable: true,
    });
    input.dispatchEvent(submit);
    assert.equal(
        submit.defaultPrevented,
        false,
        'Enter inside an editable field stays native'
    );
    input.blur();
    assert.equal(input.readOnly, true, 'leaving restores read-only');
    input.focus();
    assert.equal(input.readOnly, true);
    input.dispatchEvent(
        new dom.window.MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        })
    );
    assert.equal(input.readOnly, false, 'explicit click starts editing');
    input.blur();
    remove();
    input.focus();
    assert.equal(input.readOnly, false, 'cleanup removes the read-only guard');
});

test('Backspace and caret keys belong to text entry only while editable', (t) => {
    const dom = browser(t);
    const input = dom.window.document.querySelector(
        'input'
    ) as HTMLInputElement;
    const backspace = () => {
        const event = new dom.window.KeyboardEvent('keydown', {
            key: 'Backspace',
            keyCode: 8,
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(event);
        return event;
    };
    assert.equal(
        backspaceEdits(backspace()),
        true,
        'editable field keeps deletion'
    );
    input.readOnly = true;
    assert.equal(
        backspaceEdits(backspace()),
        false,
        'read-only field passes Back'
    );
    assert.equal(editingText(input), false);
    input.readOnly = false;
    assert.equal(editingText(input), true);
    const remove = installImeGuard();
    let backs = 0;
    const removeRemote = installRemote(
        () => backs++,
        () => false,
        () => undefined
    );
    input.readOnly = true;
    backspace();
    assert.equal(backs, 1, 'read-only Backspace reaches the back action');
    input.readOnly = false;
    backspace();
    assert.equal(backs, 1, 'editable Backspace stays native deletion');
    removeRemote();
    remove();
});

test('IME guard unlocks form fields on submit so required checks still run', (t) => {
    const dom = browser(t);
    const form = dom.window.document.createElement('form');
    const required = dom.window.document.createElement('input');
    required.required = true;
    const save = dom.window.document.createElement('button');
    const other = dom.window.document.createElement('input');
    const locked = dom.window.document.createElement('input');
    locked.readOnly = true;
    form.append(required, other, locked, save);
    dom.window.document.body.append(form);
    const remove = installImeGuard();
    required.focus();
    assert.equal(required.readOnly, true);
    save.dispatchEvent(
        new dom.window.MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        })
    );
    assert.equal(
        required.readOnly,
        false,
        'submit attempt re-enables constraint validation'
    );
    other.focus();
    required.focus();
    assert.equal(other.readOnly, true);
    const enter = () =>
        required.dispatchEvent(
            new dom.window.KeyboardEvent('keydown', {
                key: 'Enter',
                keyCode: 13,
                bubbles: true,
                cancelable: true,
            })
        );
    enter();
    assert.equal(required.readOnly, false, 'Enter starts editing');
    enter();
    assert.equal(
        other.readOnly,
        false,
        'implicit submission also unlocks the form'
    );
    assert.equal(
        locked.readOnly,
        true,
        'fields owned by the app stay read-only'
    );
    remove();
});

test('physical editing keys release guarded fields without consuming the key', (t) => {
    const dom = browser(t);
    const remove = installImeGuard();
    const input = dom.window.document.querySelector('input')!;
    for (const key of [
        { key: 'a' },
        { key: '@', altKey: true },
        { key: 'Dead', altKey: true },
        { key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true },
        { key: 'Process' },
        { key: 'Unidentified', keyCode: 229 },
        { key: 'Enter', isComposing: true },
        { key: 'v', ctrlKey: true },
        { key: 'Delete' },
    ]) {
        input.focus();
        assert.equal(input.readOnly, true);
        const event = new dom.window.KeyboardEvent('keydown', {
            ...key,
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(event);
        assert.equal(input.readOnly, false, key.key);
        assert.equal(event.defaultPrevented, false, key.key);
        input.blur();
    }
    remove();
});

test('IME guard leaves range, checkbox and button inputs editable-free', (t) => {
    const dom = browser(t);
    const remove = installImeGuard();
    for (const type of ['range', 'checkbox', 'button']) {
        const control = dom.window.document.createElement('input');
        control.type = type;
        dom.window.document.body.append(control);
        control.focus();
        assert.equal(
            control.readOnly,
            false,
            `type=${type} never gains read-only focus`
        );
        control.remove();
    }
    remove();
});

test('Tizen registers used media keys only, survives an unsupported key and exits through its application API', (t) => {
    const dom = browser(t);
    const keys: string[] = [];
    const warnings: unknown[][] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
    let exits = 0;
    Object.assign(dom.window, {
        tizen: {
            tvinputdevice: {
                registerKey: (name: string) => {
                    keys.push(name);
                    if (name === 'MediaPause')
                        throw new Error('sensitive device error');
                },
            },
            application: {
                getCurrentApplication: () => ({
                    appInfo: { id: 'SyntheticT.TV' },
                    exit: () => exits++,
                }),
            },
        },
    });
    assert.equal(tvPlatformLabels[currentTvPlatform()], 'Samsung Tizen TV');
    assert.equal(tvApplicationId('fallback'), 'SyntheticT.TV');
    registerTvKeys();
    assert.deepEqual(keys, [
        'MediaPlay',
        'MediaPause',
        'MediaStop',
        'MediaRewind',
        'MediaFastForward',
        'MediaPlayPause',
    ]);
    assert.deepEqual(warnings, [
        ['TV remote key registration failed: MediaPause'],
    ]);
    platformBack();
    assert.equal(exits, 1);
});

test('browser and LG bridges retain root Back behavior without requiring Tizen APIs', (t) => {
    const dom = browser(t);
    registerTvKeys();
    platformBack();
    assert.equal(tvApplicationId('lg.id'), 'lg.id');
    let lgBacks = 0;
    let palmBacks = 0;
    Object.assign(dom.window, {
        webOS: { platformBack: () => lgBacks++ },
        PalmSystem: { platformBack: () => palmBacks++ },
    });
    platformBack();
    assert.deepEqual([lgBacks, palmBacks], [1, 0]);
    Object.assign(dom.window, { webOS: undefined });
    platformBack();
    assert.deepEqual([lgBacks, palmBacks], [1, 1]);
});
