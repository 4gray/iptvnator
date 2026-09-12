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
