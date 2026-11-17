import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { TvMediaAction } from '@iptvnator/tv/util';
import { installRemote } from '@iptvnator/tv/ui';

function browser(t: TestContext) {
    const dom = new JSDOM(
        '<button>Start</button><input><input type="range" min="0" max="100">'
    );
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

test('Space toggles fullscreen playback and never presses the focused control', (t) => {
    const dom = browser(t);
    let fullscreen = true;
    const actions: TvMediaAction[] = [];
    const remove = installRemote(
        () => undefined,
        () => fullscreen,
        (action) => actions.push(action)
    );
    const space = (target: Element, type = 'keydown', repeat = false) => {
        const event = new dom.window.KeyboardEvent(type, {
            key: ' ',
            keyCode: 32,
            repeat,
            bubbles: true,
            cancelable: true,
        });
        target.dispatchEvent(event);
        return event;
    };
    const button = dom.window.document.querySelector('button')!;
    const input = dom.window.document.querySelector('input')!;
    assert.equal(space(button).defaultPrevented, true);
    assert.equal(space(button, 'keyup').defaultPrevented, true);
    assert.deepEqual(actions, ['toggle']);
    space(button, 'keydown', true);
    assert.deepEqual(actions, ['toggle'], 'auto-repeat does not flip it back');
    assert.equal(space(input).defaultPrevented, false, 'typing keeps Space');
    fullscreen = false;
    assert.equal(space(button).defaultPrevented, false, 'outside the player');
    assert.equal(space(button, 'keyup').defaultPrevented, false);
    assert.deepEqual(actions, ['toggle']);
    remove();
});

test('Space still toggles playback while the seek slider has focus', (t) => {
    const dom = browser(t);
    const actions: TvMediaAction[] = [];
    const remove = installRemote(
        () => undefined,
        () => true,
        (action) => actions.push(action)
    );
    const slider = dom.window.document.querySelector('input[type="range"]')!;
    const event = new dom.window.KeyboardEvent('keydown', {
        key: ' ',
        keyCode: 32,
        bubbles: true,
        cancelable: true,
    });
    slider.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(actions, ['toggle']);
    remove();
});
