// Keep Zone's fakeAsync helpers while preserving the Angular 21 test scheduler.
import 'zone.js';
import 'zone.js/testing';
import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless/index.mjs';
import { installDuplicateVideoJsQualityLevelsWarnFilter } from '@iptvnator/shared/testing';

Object.defineProperty(globalThis, 'jest', {
    configurable: true,
    value: import.meta.jest,
});

if (
    typeof (globalThis as { IDBFactory?: unknown }).IDBFactory === 'undefined'
) {
    Object.defineProperty(globalThis, 'IDBFactory', {
        configurable: true,
        value: class MockIDBFactory {},
    });
}

if (!Element.prototype.animate) {
    Element.prototype.animate = () =>
        ({
            cancel: () => undefined,
            finished: Promise.resolve(),
        }) as unknown as Animation;
}

installDuplicateVideoJsQualityLevelsWarnFilter();

setupZonelessTestEnv({
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
});
