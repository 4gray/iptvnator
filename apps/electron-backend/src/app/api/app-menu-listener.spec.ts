import { APP_MENU_ACTION } from '@iptvnator/shared/interfaces';
import { createAppMenuListener } from './app-menu-listener';

describe('app menu preload listener', () => {
    it('buffers a startup click, validates commands and stops delivering after unsubscribe', () => {
        let receive!: (_event: unknown, action: unknown) => void;
        const on = jest.fn((_channel, callback) => {
            receive = callback;
        });
        const subscribe = createAppMenuListener({
            on,
        } as unknown as Electron.IpcRenderer);
        expect(on).toHaveBeenCalledWith(APP_MENU_ACTION, expect.any(Function));
        receive({}, 'settings');
        const listener = jest.fn();
        const unsubscribe = subscribe(listener);
        expect(listener).toHaveBeenCalledWith('settings');
        receive({}, 'check-for-updates');
        receive({}, { action: 'settings' });
        receive({}, '/arbitrary/route');
        expect(listener.mock.calls).toEqual([
            ['settings'],
            ['check-for-updates'],
        ]);
        unsubscribe();
        receive({}, 'settings');
        expect(listener).toHaveBeenCalledTimes(2);
        const replacement = jest.fn();
        subscribe(replacement);
        expect(replacement).toHaveBeenCalledWith('settings');
    });
});
