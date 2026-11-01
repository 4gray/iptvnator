import { Injector } from '@angular/core';
import { DatabaseService } from './database-electron.service';
import { PlaylistStorageBackend } from './playlist-storage-backend';

const original = window.electron;
let injector: Injector;
afterEach(() => {
    (injector as Injector & { destroy?: () => void })?.destroy?.();
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: original,
    });
});

it.each([
    {
        explicit: true,
        response: { success: true, explicitRecorded: true },
        expected: true,
    },
    { explicit: true, response: { success: true }, expected: false },
    {
        explicit: true,
        response: { success: false, explicitRecorded: true },
        expected: false,
    },
    { explicit: undefined, response: { success: true }, expected: true },
])(
    'requires native intent acknowledgment only for explicit visibility: %j',
    async ({ explicit, response, expected }) => {
        const write = jest.fn().mockResolvedValue(response);
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: { dbUpdateCategoryVisibility: write },
        });
        injector = Injector.create({
            providers: [
                DatabaseService,
                { provide: PlaylistStorageBackend, useValue: {} },
            ],
        });
        const service = injector.get(DatabaseService);
        await expect(
            service.updateCategoryVisibility([22], false, explicit)
        ).resolves.toBe(expected);
        expect(write.mock.calls).toEqual([
            explicit ? [[22], false, true] : [[22], false],
        ]);
    }
);
