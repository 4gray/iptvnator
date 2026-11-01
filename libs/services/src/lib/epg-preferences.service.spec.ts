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
        window.electron = {
            ...original,
            setEpgEnabled: (enabled: boolean) =>
                enabled ? enabling : Promise.resolve(),
        } as typeof window.electron;
        try {
            const oldEnable = preferences.apply(true);
            await preferences.apply(false);
            finish();
            await oldEnable;
            expect(preferences.enabled()).toBe(false);
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
