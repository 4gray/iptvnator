import {
    EnvironmentInjector,
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
} from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { createXtreamConnectionTestState } from './xtream-connection-test-state';
import { XtreamConnectionTestService } from './xtream-connection-test.service';

describe('Xtream form connection test lifecycle', () => {
    it.each([
        ['', 'pass'],
        ['user', ''],
        ['   ', 'pass'],
        ['user', '  '],
    ])(
        'explains empty credentials without requesting the portal: %j / %j',
        async (username, password) => {
            const test = jest
                .fn()
                .mockResolvedValue({
                    status: 'active',
                    serverUrl: 'https://panel.test',
                    usedHttpFallback: false,
                });
            const injector = createEnvironmentInjector(
                [{ provide: XtreamConnectionTestService, useValue: { test } }],
                Injector.NULL as unknown as EnvironmentInjector
            );
            const form = new FormGroup({
                serverUrl: new FormControl('https://panel.test'),
                username: new FormControl(username),
                password: new FormControl(password),
            });
            const state = runInInjectionContext(injector, () =>
                createXtreamConnectionTestState(form)
            );
            try {
                await state.test(true);
                expect(state.messageKey()).toBe(
                    'HOME.XTREAM_PLAYLIST.CONNECTION_TEST.CREDENTIALS_REQUIRED'
                );
                expect(state.testing()).toBe(false);
                expect(test).not.toHaveBeenCalled();
                form.patchValue({ username: 'user', password: 'pass' });
                expect(state.messageKey()).toBe('');
                await state.test(true);
                expect(state.messageKey()).toBe(
                    'HOME.XTREAM_PLAYLIST.CONNECTION_TEST.ACTIVE'
                );
                expect(test).toHaveBeenCalledTimes(1);
            } finally {
                injector.destroy();
            }
        }
    );

    it('releases the form subscription and ignores in-flight results on destroy', async () => {
        let complete!: (result: unknown) => void;
        const test = jest.fn(
            () =>
                new Promise((resolve) => {
                    complete = resolve;
                })
        );
        const injector = createEnvironmentInjector(
            [{ provide: XtreamConnectionTestService, useValue: { test } }],
            Injector.NULL as unknown as EnvironmentInjector
        );
        const form = new FormGroup({
            serverUrl: new FormControl('https://panel.test'),
            username: new FormControl('user'),
            password: new FormControl('pass'),
        });
        const subscribe = jest.spyOn(form.valueChanges, 'subscribe');
        const state = runInInjectionContext(injector, () =>
            createXtreamConnectionTestState(form)
        );
        const pending = state.test(true);
        expect(subscribe.mock.results[0].value.closed).toBe(false);
        injector.destroy();
        expect(subscribe.mock.results[0].value.closed).toBe(true);
        complete({
            status: 'active',
            serverUrl: 'http://panel.test',
            usedHttpFallback: true,
        });
        await pending;
        expect(form.controls.serverUrl.value).toBe('https://panel.test');
        expect(state.result()).toBeNull();
        expect(test.mock.calls).toHaveLength(1);
    });
});
