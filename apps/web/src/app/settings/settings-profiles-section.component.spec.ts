import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ParentalLockService } from '@iptvnator/services';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    DEFAULT_PROFILE_ID,
    PROFILE_LIMIT,
} from '@iptvnator/shared/interfaces/profiles';
import { DialogService } from '@iptvnator/ui/components/confirm-dialog';
import {
    ADULT_ID,
    fail,
    fakeRuntime,
    KIDS_ID,
    ok,
    PIN_ID,
    syntheticProfile,
} from '../profiles/profiles.stub';
import { ProfilesRuntime } from '../services/profiles-runtime';
import { SettingsProfilesSectionComponent } from './settings-profiles-section.component';

const NAS = 'synthetic-nas';

async function setup(
    options: {
        profiles?: ReturnType<typeof syntheticProfile>[];
        parental?: boolean;
    } = {}
) {
    localStorage.setItem(
        'iptvnator:source-server',
        JSON.stringify({ apiUrl: 'https://nas.example/api', instanceId: NAS })
    );
    await prepareSourceConnection();
    const fake = fakeRuntime(options.profiles);
    const dialogOpen = jest.fn();
    const requestUnlock = jest.fn(async () => options.parental ?? true);
    const openConfirmDialog = jest.fn(async (data: { onConfirm: () => void }) =>
        data.onConfirm()
    );
    TestBed.configureTestingModule({
        imports: [TranslateModule.forRoot(), SettingsProfilesSectionComponent],
        providers: [
            { provide: ProfilesRuntime, useValue: fake.runtime },
            { provide: MatDialog, useValue: { open: dialogOpen } },
            { provide: ParentalLockService, useValue: { requestUnlock } },
            { provide: DialogService, useValue: { openConfirmDialog } },
        ],
    });
    const fixture = TestBed.createComponent(SettingsProfilesSectionComponent);
    const settle = async () => {
        // The runtime arrives through a dynamic import.
        for (let turn = 0; turn < 3; turn++)
            await new Promise((resolve) => setTimeout(resolve, 0));
        await fixture.whenStable();
        fixture.detectChanges();
    };
    fixture.detectChanges();
    await settle();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) =>
        el.querySelector<HTMLElement>(`[data-test-id="${id}"]`);
    const click = async (id: string) => {
        q(id)!.click();
        await settle();
    };
    /** The next dialog the section opens closes with `result`. */
    const answerDialog = (result: unknown) =>
        dialogOpen.mockReturnValueOnce({ afterClosed: () => of(result) });
    return {
        fake,
        fixture,
        el,
        q,
        click,
        answerDialog,
        dialogOpen,
        requestUnlock,
        openConfirmDialog,
    };
}

describe('SettingsProfilesSectionComponent', () => {
    beforeEach(() => localStorage.clear());

    it('lists profiles in order with kids and PIN badges, and no delete or reorder for Default', async () => {
        const { q, el } = await setup();
        const rows = Array.from(
            el.querySelectorAll('[data-test-id^="profile-row-"]')
        ).map((row) => row.getAttribute('data-test-id'));
        expect(rows).toEqual([
            `profile-row-${DEFAULT_PROFILE_ID}`,
            `profile-row-${ADULT_ID}`,
            `profile-row-${KIDS_ID}`,
            `profile-row-${PIN_ID}`,
        ]);
        expect(
            q(`profile-row-${KIDS_ID}`)!.querySelector(
                '[data-test-id="profile-badge-kids"]'
            )
        ).toBeTruthy();
        expect(
            q(`profile-row-${PIN_ID}`)!.querySelector(
                '[data-test-id="profile-badge-pin"]'
            )
        ).toBeTruthy();
        expect(q(`profile-delete-${DEFAULT_PROFILE_ID}`)).toBeNull();
        expect(q(`profile-move-up-${DEFAULT_PROFILE_ID}`)).toBeNull();
        expect(
            (q(`profile-move-up-${ADULT_ID}`) as HTMLButtonElement).disabled
        ).toBe(true);
        expect(
            (q(`profile-move-down-${PIN_ID}`) as HTMLButtonElement).disabled
        ).toBe(true);
    });

    it('renders the household switch and turns profiles on through the client', async () => {
        const { fake, q, fixture } = await setup();
        fake.client.setEnabled.mockResolvedValue(ok({}));
        expect(q('profiles-enabled')).toBeTruthy();
        await fixture.componentInstance.facade.setEnabled(false);
        expect(fake.client.setEnabled).toHaveBeenCalledWith(false);
        expect(fake.runtime.refresh).toHaveBeenCalled();
    });

    it('stores the start-up choice per server instance and device', async () => {
        const { click } = await setup();
        await click('profiles-start-last');
        expect(
            localStorage.getItem(`iptvnator-server:${NAS}:profiles-start-v1`)
        ).toBe('last');
        await click('profiles-start-ask');
        expect(
            localStorage.getItem(`iptvnator-server:${NAS}:profiles-start-v1`)
        ).toBe('ask');
    });

    it('adds a profile with the form values and refreshes the runtime', async () => {
        const { fake, click, answerDialog } = await setup();
        fake.client.create.mockResolvedValue(ok({}));
        answerDialog({
            name: 'New one',
            colour: '#14b8a6',
            emoji: '🦊',
            kids: true,
            pin: null,
        });
        await click('profile-add');
        expect(fake.client.create).toHaveBeenCalledWith({
            name: 'New one',
            colour: '#14b8a6',
            emoji: '🦊',
            kids: true,
        });
        expect(fake.runtime.refresh).toHaveBeenCalled();
    });

    it('sends a PIN only for an adult profile that set one', async () => {
        const { fake, click, answerDialog } = await setup();
        fake.client.create.mockResolvedValue(ok({}));
        answerDialog({
            name: 'Pin',
            colour: '#22c55e',
            emoji: null,
            kids: false,
            pin: '2468',
        });
        await click('profile-add');
        expect(fake.client.create).toHaveBeenCalledWith({
            name: 'Pin',
            colour: '#22c55e',
            pin: '2468',
        });
    });

    it('disables add at the profile limit', async () => {
        const many = Array.from({ length: PROFILE_LIMIT }, (_, index) =>
            syntheticProfile(
                index === 0
                    ? DEFAULT_PROFILE_ID
                    : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
                index
            )
        );
        const { q } = await setup({ profiles: many });
        expect((q('profile-add') as HTMLButtonElement).disabled).toBe(true);
        expect(q('profiles-limit')).toBeTruthy();
    });

    it('sends only the changed fields when editing, and nothing when nothing changed', async () => {
        const { fake, click, answerDialog } = await setup();
        fake.client.update.mockResolvedValue(ok({}));
        answerDialog({
            name: 'Renamed',
            colour: '#3b82f6',
            emoji: null,
            kids: false,
            pin: undefined,
        });
        await click(`profile-edit-${ADULT_ID}`);
        expect(fake.client.update).toHaveBeenCalledWith(ADULT_ID, {
            name: 'Renamed',
        });

        fake.client.update.mockClear();
        answerDialog({
            name: 'Synthetic 1',
            colour: '#3b82f6',
            emoji: null,
            kids: false,
            pin: undefined,
        });
        await click(`profile-edit-${ADULT_ID}`);
        expect(fake.client.update).not.toHaveBeenCalled();
    });

    it('asks for the current PIN to change a PIN, sends it with the update and never shows it', async () => {
        const { fake, click, answerDialog, dialogOpen, el } = await setup();
        fake.client.update.mockResolvedValue(ok({}));
        answerDialog({
            name: 'Synthetic 3',
            colour: '#3b82f6',
            emoji: null,
            kids: false,
            pin: '9999',
        });
        dialogOpen.mockReturnValueOnce({ afterClosed: () => of(true) });
        await click(`profile-edit-${PIN_ID}`);
        const pinDialog = dialogOpen.mock.calls[1][1].data;
        await pinDialog.submit('1234');
        expect(fake.client.update).toHaveBeenCalledWith(PIN_ID, {
            pin: '9999',
            currentPin: '1234',
        });
        expect(el.textContent).not.toContain('1234');
    });

    it('asks for the parental PIN before clearing kids, and stops when it is refused', async () => {
        const { fake, click, answerDialog, requestUnlock } = await setup({
            parental: false,
        });
        answerDialog({
            name: 'Synthetic 2',
            colour: '#3b82f6',
            emoji: null,
            kids: false,
            pin: undefined,
        });
        await click(`profile-edit-${KIDS_ID}`);
        expect(requestUnlock).toHaveBeenCalledTimes(1);
        expect(fake.client.update).not.toHaveBeenCalled();
    });

    it('clears kids once the parental PIN is accepted', async () => {
        const { fake, click, answerDialog, requestUnlock } = await setup();
        fake.client.update.mockResolvedValue(ok({}));
        answerDialog({
            name: 'Synthetic 2',
            colour: '#3b82f6',
            emoji: null,
            kids: false,
            pin: undefined,
        });
        await click(`profile-edit-${KIDS_ID}`);
        expect(requestUnlock).toHaveBeenCalled();
        expect(fake.client.update).toHaveBeenCalledWith(KIDS_ID, {
            kids: false,
        });
    });

    it('deletes a plain profile after a confirmation', async () => {
        const { fake, click, openConfirmDialog } = await setup();
        fake.client.remove.mockResolvedValue(ok(undefined));
        await click(`profile-delete-${ADULT_ID}`);
        expect(openConfirmDialog).toHaveBeenCalledTimes(1);
        expect(fake.client.remove).toHaveBeenCalledWith(ADULT_ID);
    });

    it('asks the PIN of a PIN profile and deletes with it', async () => {
        const { fake, click, dialogOpen } = await setup();
        fake.client.remove.mockResolvedValue(ok(undefined));
        dialogOpen.mockReturnValueOnce({ afterClosed: () => of(true) });
        await click(`profile-delete-${PIN_ID}`);
        await dialogOpen.mock.calls[0][1].data.submit('1234');
        expect(fake.client.remove).toHaveBeenCalledWith(PIN_ID, '1234');
    });

    it('asks the parental PIN before deleting a kids profile and aborts when refused', async () => {
        const { fake, click, requestUnlock, openConfirmDialog } = await setup({
            parental: false,
        });
        await click(`profile-delete-${KIDS_ID}`);
        expect(requestUnlock).toHaveBeenCalled();
        expect(openConfirmDialog).not.toHaveBeenCalled();
        expect(fake.client.remove).not.toHaveBeenCalled();
    });

    it('reorders with every id once, Default first', async () => {
        const { fake, click } = await setup();
        fake.client.reorder.mockResolvedValue(ok({}));
        await click(`profile-move-up-${KIDS_ID}`);
        expect(fake.client.reorder).toHaveBeenCalledWith([
            DEFAULT_PROFILE_ID,
            KIDS_ID,
            ADULT_ID,
            PIN_ID,
        ]);
    });

    it.each([
        [{ code: 'profile_name_taken' as const }, 'PROFILES.ERRORS.NAME_TAKEN'],
        [{ code: 'profile_limit' as const }, 'PROFILES.ERRORS.LIMIT'],
        [{ code: 'offline' as const }, 'PROFILES.ERRORS.OFFLINE'],
        [
            { code: 'default_profile' as const },
            'PROFILES.ERRORS.DEFAULT_PROFILE',
        ],
    ])('shows a translated message for %p', async (error, key) => {
        const { fake, click, answerDialog, q } = await setup();
        fake.client.create.mockResolvedValue(fail(error));
        answerDialog({
            name: 'X',
            colour: '#3b82f6',
            emoji: null,
            kids: false,
            pin: undefined,
        });
        await click('profile-add');
        expect(q('profiles-error')!.textContent).toContain(key);
        expect(fake.runtime.handleProfileError).toHaveBeenCalledWith(
            error.code
        );
    });

    it('shows an offline state with retry when the list never loaded', async () => {
        const { fake, fixture, el } = await setup();
        fake.list.set(null);
        fake.state.set('offline');
        fixture.detectChanges();
        expect(
            el.querySelector('app-state-view[variant="offline"]')
        ).toBeTruthy();
    });
});
