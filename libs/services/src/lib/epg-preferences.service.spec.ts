import { TestBed } from '@angular/core/testing';
import { EpgPreferencesService } from './epg-preferences.service';

describe('global EPG preference', () => {
    let preferences: EpgPreferencesService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        preferences = TestBed.inject(EpgPreferencesService);
    });

    it('keeps the latest opt-out when an earlier native enable finishes last', async () => {
        const original = window.electron;
        let finish!: () => void;
        const enabling = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const setEpgEnabled = jest.fn((enabled: boolean) =>
            enabled ? enabling : Promise.resolve()
        );
        window.electron = {
            ...original,
            setEpgEnabled,
        } as typeof window.electron;
        try {
            await preferences.apply(false);
            const oldEnable = preferences.apply(true);
            await preferences.apply(false);
            finish();
            await oldEnable;
            expect(preferences.enabled()).toBe(false);
            await preferences.apply(true);
            expect(
                setEpgEnabled.mock.calls.map(([enabled]) => enabled)
            ).toEqual([false, true, false, true]);
        } finally {
            window.electron = original;
        }
    });

    it('uses acknowledged bootstrap state without repeating the enable IPC', async () => {
        const original = window.electron;
        const setEpgEnabled = jest.fn().mockResolvedValue(undefined);
        window.electron = {
            ...original,
            setEpgEnabled,
        } as typeof window.electron;
        try {
            preferences.beginLoad();
            await preferences.synchronizeNative(true, async () => undefined);
            await preferences.apply(true);
            expect(preferences.enabled()).toBe(true);
            expect(setEpgEnabled).not.toHaveBeenCalled();
            await preferences.apply(false);
            await preferences.apply(false);
            await preferences.apply(true);
            expect(setEpgEnabled.mock.calls).toEqual([[false], [true]]);
        } finally {
            window.electron = original;
        }
    });

    it('synchronizes an unknown native state when a renderer is recreated', async () => {
        const original = window.electron;
        const setEpgEnabled = jest.fn().mockResolvedValue(undefined);
        window.electron = {
            ...original,
            setEpgEnabled,
        } as typeof window.electron;
        try {
            await preferences.apply(true);
            expect(setEpgEnabled.mock.calls).toEqual([[true]]);
        } finally {
            window.electron = original;
        }
    });

    it('retries a native state change after a failed acknowledgement', async () => {
        const original = window.electron;
        const setEpgEnabled = jest
            .fn()
            .mockRejectedValueOnce(new Error('Synthetic bridge failure'))
            .mockResolvedValue(undefined);
        window.electron = {
            ...original,
            setEpgEnabled,
        } as typeof window.electron;
        try {
            await expect(preferences.apply(false)).rejects.toThrow(
                'Synthetic bridge failure'
            );
            await preferences.apply(false);
            expect(setEpgEnabled.mock.calls).toEqual([[false], [false]]);
        } finally {
            window.electron = original;
        }
    });

    it('defaults on and never calls a loader when explicitly disabled', async () => {
        const load = jest.fn().mockResolvedValue(['programme']);
        expect(await preferences.run(load, [])).toEqual(['programme']);
        await preferences.apply(false);
        load.mockClear();
        expect(await preferences.run(load, [])).toEqual([]);
        expect(load).not.toHaveBeenCalled();
    });

    it('waits for stored settings before allowing a startup request', async () => {
        preferences.beginLoad();
        const load = jest.fn().mockResolvedValue(['programme']);
        const request = preferences.run(load, []);
        await Promise.resolve();
        expect(load).not.toHaveBeenCalled();
        await preferences.apply(false);
        expect(await request).toEqual([]);
        expect(load).not.toHaveBeenCalled();
    });

    it('rechecks opt-out when readiness resolves before the request resumes', async () => {
        const load = jest.fn().mockResolvedValue(['programme']);
        const pending = preferences.run(load, []);
        await Promise.resolve();
        await preferences.apply(false);
        expect(await pending).toEqual([]);
        expect(load).not.toHaveBeenCalled();
    });

    it('ignores an old response even after EPG is enabled again', async () => {
        let finish!: (result: string[]) => void;
        const load = jest.fn(
            () =>
                new Promise<string[]>((resolve) => {
                    finish = resolve;
                })
        );
        const request = preferences.run(load, []);
        await Promise.resolve();
        await Promise.resolve();
        await preferences.apply(false);
        await preferences.apply(true);
        finish(['stale programme']);
        expect(await request).toEqual([]);
        expect(
            await preferences.run(async () => ['fresh programme'], [])
        ).toEqual(['fresh programme']);
    });

    it('does not report late request failures after disabling EPG', async () => {
        let fail!: (error: Error) => void;
        const request = preferences.run(
            () =>
                new Promise<string[]>((_resolve, reject) => {
                    fail = reject;
                }),
            []
        );
        await Promise.resolve();
        await Promise.resolve();
        await preferences.apply(false);
        fail(new Error('retired request'));
        expect(await request).toEqual([]);
    });
});
