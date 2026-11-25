import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ParentalLockService } from '@iptvnator/services';
import { DEFAULT_PROFILE_ID } from '@iptvnator/shared/interfaces/profiles';
import { ProfileSwitchService } from '../services/profile-switch.service';
import { ProfilesRuntime } from '../services/profiles-runtime';
import { ProfilePickerComponent } from './profile-picker.component';
import {
    profilePickedThisSession,
    resetProfilePickedForTests,
} from './profile-picker-route';
import {
    ADULT_ID,
    fail,
    fakeRuntime,
    KIDS_ID,
    ok,
    PIN_ID,
} from './profiles.stub';

async function setup(
    options: { returnUrl?: string | null; parental?: boolean } = {}
) {
    const fake = fakeRuntime();
    const navigateByUrl = jest.fn(async () => true);
    const dialogOpen = jest.fn();
    const confirmPin = jest.fn(async () => options.parental ?? true);
    const apply = jest.fn(async (_scope: string) => undefined);
    TestBed.configureTestingModule({
        imports: [TranslateModule.forRoot(), ProfilePickerComponent],
        providers: [
            { provide: ProfilesRuntime, useValue: fake.runtime },
            {
                provide: Router,
                useValue: {
                    navigateByUrl,
                    createUrlTree: jest.fn(),
                    serializeUrl: () => '',
                    events: of(),
                },
            },
            {
                provide: ActivatedRoute,
                useValue: {
                    snapshot: {
                        queryParamMap: {
                            get: () =>
                                options.returnUrl === undefined
                                    ? '/workspace/dashboard'
                                    : options.returnUrl,
                        },
                    },
                },
            },
            { provide: MatDialog, useValue: { open: dialogOpen } },
            { provide: ParentalLockService, useValue: { confirmPin } },
            { provide: ProfileSwitchService, useValue: { apply } },
        ],
    });
    const fixture = TestBed.createComponent(ProfilePickerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tile = (id: string) =>
        el.querySelector<HTMLButtonElement>(
            `[data-test-id="profile-tile-${id}"]`
        )!;
    const tiles = () =>
        Array.from(
            el.querySelectorAll<HTMLButtonElement>('.profile-picker__tile')
        );
    const press = (target: HTMLElement, key: string) => {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        target.dispatchEvent(event);
        return event;
    };
    const choose = async (id: string) => {
        tile(id).click();
        await fixture.whenStable();
        fixture.detectChanges();
    };
    return {
        fake,
        fixture,
        el,
        tile,
        tiles,
        press,
        choose,
        navigateByUrl,
        dialogOpen,
        confirmPin,
        apply,
    };
}

/** jsdom has no layout: put the tiles on rows of `columns`. */
function layOut(tiles: HTMLElement[], columns: number) {
    tiles.forEach((tile, index) =>
        Object.defineProperty(tile, 'offsetTop', {
            configurable: true,
            value: Math.floor(index / columns) * 200,
        })
    );
}

describe('ProfilePickerComponent', () => {
    beforeEach(() => {
        localStorage.clear();
        resetProfilePickedForTests();
    });

    it('renders one button per profile in order, with kids and PIN marks', async () => {
        const { tiles, el } = await setup();
        expect(
            tiles().map((tile) => tile.getAttribute('data-test-id'))
        ).toEqual([
            `profile-tile-${DEFAULT_PROFILE_ID}`,
            `profile-tile-${ADULT_ID}`,
            `profile-tile-${KIDS_ID}`,
            `profile-tile-${PIN_ID}`,
        ]);
        expect(tiles().every((tile) => tile.tagName === 'BUTTON')).toBe(true);
        expect(el.textContent).toContain('PROFILES.BADGE_KIDS');
        expect(
            el.querySelector('[data-test-id="profile-picker-manage"]')
        ).toBeTruthy();
    });

    it('focuses the active profile on open, or the first one', async () => {
        const first = await setup();
        expect(document.activeElement).toBe(first.tile(DEFAULT_PROFILE_ID));
        TestBed.resetTestingModule();

        const fake = fakeRuntime();
        fake.activeId.set(ADULT_ID);
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), ProfilePickerComponent],
            providers: [
                { provide: ProfilesRuntime, useValue: fake.runtime },
                {
                    provide: Router,
                    useValue: {
                        navigateByUrl: jest.fn(),
                        createUrlTree: jest.fn(),
                        serializeUrl: () => '',
                        events: of(),
                    },
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { queryParamMap: { get: () => null } },
                    },
                },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                {
                    provide: ParentalLockService,
                    useValue: { confirmPin: jest.fn() },
                },
            ],
        });
        const fixture = TestBed.createComponent(ProfilePickerComponent);
        document.body.appendChild(fixture.nativeElement);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(document.activeElement?.getAttribute('data-test-id')).toBe(
            `profile-tile-${ADULT_ID}`
        );
        fixture.nativeElement.remove();
    });

    it('moves with the arrow keys in the grid and leaves the edges to the page', async () => {
        const { tiles, press, fixture } = await setup();
        document.body.appendChild(fixture.nativeElement);
        layOut(tiles(), 3); // rows: [0 1 2] [3]
        tiles()[0].focus();
        expect(press(tiles()[0], 'ArrowRight').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(tiles()[1]);
        expect(press(tiles()[1], 'ArrowDown').defaultPrevented).toBe(false); // nothing below column 1
        expect(press(tiles()[1], 'ArrowRight').defaultPrevented).toBe(true);
        expect(press(tiles()[2], 'ArrowRight').defaultPrevented).toBe(false); // row end
        expect(press(tiles()[2], 'ArrowDown').defaultPrevented).toBe(false);
        press(tiles()[0], 'ArrowDown');
        expect(document.activeElement).toBe(tiles()[3]);
        expect(press(tiles()[3], 'ArrowUp').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(tiles()[0]);
        expect(press(tiles()[0], 'ArrowLeft').defaultPrevented).toBe(false); // row start
        press(tiles()[0], 'End');
        expect(document.activeElement).toBe(tiles()[3]);
        press(tiles()[3], 'Home');
        expect(document.activeElement).toBe(tiles()[0]);
        fixture.nativeElement.remove();
    });

    it('finishes the switch before it opens the workspace', async () => {
        const { choose, apply, navigateByUrl, fake } = await setup();
        let release!: () => void;
        apply.mockImplementationOnce(
            () =>
                new Promise<undefined>(
                    (resolve) => (release = () => resolve(undefined))
                )
        );
        fake.runtime.scope.set('shared');
        void choose(ADULT_ID);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(apply).toHaveBeenCalledWith('shared');
        expect(navigateByUrl).not.toHaveBeenCalled();
        release();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(navigateByUrl).toHaveBeenCalled();
    });

    it('selects a plain profile and goes to the return url', async () => {
        const { fake, choose, navigateByUrl } = await setup();
        await choose(ADULT_ID);
        expect(fake.runtime.select).toHaveBeenCalledWith(ADULT_ID);
        expect(navigateByUrl).toHaveBeenCalledWith('/workspace/dashboard');
        expect(profilePickedThisSession()).toBe(true);
    });

    it('never follows a return url that leaves the app', async () => {
        const { choose, navigateByUrl } = await setup({
            returnUrl: 'https://evil.test',
        });
        await choose(ADULT_ID);
        expect(navigateByUrl).toHaveBeenCalledWith('/workspace');
    });

    it('asks a PIN profile for its PIN through the server and selects after it is accepted', async () => {
        const { fake, choose, dialogOpen, navigateByUrl } = await setup();
        fake.client.unlock.mockResolvedValue(ok(undefined));
        dialogOpen.mockReturnValueOnce({ afterClosed: () => of(true) });
        await choose(PIN_ID);
        const data = dialogOpen.mock.calls[0][1].data;
        await expect(data.submit('1234')).resolves.toEqual(ok(undefined));
        expect(fake.client.unlock).toHaveBeenCalledWith(PIN_ID, '1234');
        expect(fake.runtime.select).toHaveBeenCalledWith(PIN_ID);
        expect(navigateByUrl).toHaveBeenCalled();
    });

    it('passes a wrong PIN, a lockout and the rate limit through to the dialog and tells the runtime', async () => {
        const { fake, choose, dialogOpen } = await setup();
        dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
        await choose(PIN_ID);
        const submit = dialogOpen.mock.calls[0][1].data.submit;
        for (const error of [
            { code: 'wrong_pin' as const },
            { code: 'pin_locked' as const, retryAfter: 30 },
            { code: 'pin_rate_limited' as const, retryAfter: 12 },
            { code: 'profile_missing' as const },
        ]) {
            fake.client.unlock.mockResolvedValueOnce(fail(error));
            await expect(submit('1234')).resolves.toEqual(fail(error));
        }
        expect(fake.runtime.handleProfileError).toHaveBeenCalledWith(
            'profile_missing',
            PIN_ID
        );
    });

    it('re-verifies the server before retrying a PIN after a network failure', async () => {
        const { fake, choose, dialogOpen } = await setup();
        dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
        await choose(PIN_ID);
        const submit = dialogOpen.mock.calls[0][1].data.submit;
        fake.client.unlock.mockResolvedValueOnce(fail({ code: 'offline' }));
        await submit('1234');
        expect(fake.runtime.recheck).not.toHaveBeenCalled();
        fake.client.unlock.mockResolvedValue(ok(undefined));
        await submit('1234');
        expect(fake.runtime.recheck).toHaveBeenCalledTimes(1);
        await submit('1234');
        expect(fake.runtime.recheck).toHaveBeenCalledTimes(1);
    });

    it('stays on the picker when the PIN prompt is closed with Back or Escape', async () => {
        const { fake, choose, dialogOpen, navigateByUrl } = await setup();
        dialogOpen.mockReturnValueOnce({ afterClosed: () => of(undefined) });
        await choose(PIN_ID);
        expect(fake.runtime.select).not.toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('asks the parental PIN before leaving a kids profile and stays when it is refused', async () => {
        const { fake, choose, confirmPin, navigateByUrl } = await setup({
            parental: false,
        });
        fake.activeId.set(KIDS_ID);
        await choose(ADULT_ID);
        expect(confirmPin).toHaveBeenCalledTimes(1);
        expect(fake.runtime.select).not.toHaveBeenCalled();
        expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('leaves a kids profile once the parental PIN is accepted, and does not ask to stay on it', async () => {
        const { fake, choose, confirmPin } = await setup();
        fake.activeId.set(KIDS_ID);
        await choose(ADULT_ID);
        expect(confirmPin).toHaveBeenCalledTimes(1);
        expect(fake.runtime.select).toHaveBeenCalledWith(ADULT_ID);
        confirmPin.mockClear();
        fake.runtime.select.mockClear();
        await choose(KIDS_ID);
        expect(confirmPin).not.toHaveBeenCalled();
        expect(fake.runtime.select).toHaveBeenCalledWith(KIDS_ID);
    });

    it('offers to continue as Default when the server never answered', async () => {
        const { fake, fixture, el, navigateByUrl } = await setup();
        fake.list.set(null);
        fake.state.set('offline');
        fixture.detectChanges();
        expect(el.querySelector('app-state-view')).toBeTruthy();
        fixture.componentInstance.continueAsDefault();
        expect(navigateByUrl).toHaveBeenCalledWith('/workspace/dashboard');
        expect(profilePickedThisSession()).toBe(true);
        expect(fake.runtime.holdDefault).toHaveBeenCalled();
    });

    it('does not load forever when the server has no profiles', async () => {
        const { fake, fixture, el, navigateByUrl } = await setup();
        fake.list.set(null);
        fake.state.set('unsupported');
        fixture.detectChanges();
        expect(el.querySelector('.profile-picker__status')).toBeNull();
        expect(el.querySelector('app-state-view')).toBeTruthy();
        fixture.componentInstance.continueAsDefault();
        expect(navigateByUrl).toHaveBeenCalledWith('/workspace/dashboard');
    });

    it('offers only Default while profiles are off', async () => {
        const { fake, fixture, el } = await setup();
        fake.list.update((list) => ({ ...list!, enabled: false }));
        fixture.detectChanges();
        expect(el.querySelectorAll('.profile-picker__tile')).toHaveLength(1);
    });
});
