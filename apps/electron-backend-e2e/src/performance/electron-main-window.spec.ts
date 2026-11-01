import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findMainWindow } from '../electron-main-window';

const renderer = { url: () => 'file:///synthetic/index.html' };
const devtools = { url: () => 'devtools://devtools/bundled/inspector.html' };

describe('Electron main window readiness', () => {
    it('returns an existing renderer without waiting for another window', async () => {
        const selected = await findMainWindow({
            firstWindow: async () => devtools,
            windows: () => [devtools, renderer],
            waitForEvent: async () => {
                throw new Error('unexpected window subscription');
            },
        });
        assert.equal(selected, renderer);
    });

    it('waits for a delayed first window before inspecting the snapshot', async () => {
        let open: (window: typeof renderer) => void = () => undefined;
        const firstWindow = new Promise<typeof renderer>((resolve) => {
            open = resolve;
        });
        let windows = [] as (typeof renderer)[];
        const selected = findMainWindow({
            firstWindow: () => firstWindow,
            windows: () => windows,
            waitForEvent: async () => {
                throw new Error('unexpected window subscription');
            },
        });
        windows = [renderer];
        open(renderer);
        assert.equal(await selected, renderer);
    });

    it('subscribes when DevTools is first and excludes subsequent DevTools windows', async () => {
        const selected = await findMainWindow({
            firstWindow: async () => devtools,
            windows: () => [devtools],
            waitForEvent: async (event, { predicate }) => {
                assert.equal(event, 'window');
                assert.equal(predicate(devtools), false);
                assert.equal(predicate(renderer), true);
                return renderer;
            },
        });
        assert.equal(selected, renderer);
    });

    it('propagates launch and window-wait failures for guarded disposal', async () => {
        const failure = new Error('synthetic launch failure');
        for (const firstFails of [true, false]) {
            await assert.rejects(
                findMainWindow({
                    firstWindow: async () => {
                        if (firstFails) throw failure;
                        return devtools;
                    },
                    windows: () => [devtools],
                    waitForEvent: async () => {
                        throw failure;
                    },
                }),
                (error) => error === failure
            );
        }
    });
});
