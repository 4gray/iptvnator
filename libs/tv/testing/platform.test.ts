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
    currentTvPlatform,
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
