import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { HostedDeviceList } from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsHostedDevicesComponent } from './settings-hosted-devices.component';

describe('hosted device settings', () => {
    const originalElectron = window.electron;
    const control = jest.fn();
    const copy = jest.fn(() => true);
    const confirm = jest.fn();
    const inviteId = 'a'.repeat(43);
    const inviteUrl = `http://192.168.40.5:4334/pair-device#${inviteId}`;
    const claim = {
        inviteId,
        claimId: 'b'.repeat(43),
        name: 'Synthetic phone',
        confirmationCode: '012345',
    };
    const device = { id: 'synthetic-id', name: claim.name };
    let snapshot: HostedDeviceList;
    let passwordConfigured: boolean;
    let fixture: ComponentFixture<SettingsHostedDevicesComponent>;
    let root: HTMLElement;

    function clickButton(selector: string): void {
        const button = root.querySelector<HTMLButtonElement>(selector);
        if (!button) throw new Error(`Missing button ${selector}`);
        button.click();
    }

    beforeEach(() => {
        jest.resetAllMocks();
        copy.mockReturnValue(true);
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
        snapshot = { pending: [], devices: [] };
        passwordConfigured = false;
        control.mockImplementation(async ({ action, password }) => {
            if (action === 'list') return snapshot;
            if (action === 'browser-settings') return { passwordConfigured };
            if (action === 'set-browser-password')
                passwordConfigured = password !== null;
            if (action === 'invite')
                return {
                    url: inviteUrl,
                    expiresAt: '2030-01-01T12:05:00.000Z',
                };
            if (action === 'approve')
                snapshot = { pending: [], devices: [device] };
            if (action === 'revoke') snapshot = { pending: [], devices: [] };
        });
        window.electron = {
            hostedDeviceControl: control,
        } as unknown as typeof window.electron;
        TestBed.configureTestingModule({
            imports: [
                SettingsHostedDevicesComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                { provide: Clipboard, useValue: { copy } },
                {
                    provide: DialogService,
                    useValue: { openConfirmDialog: confirm },
                },
            ],
        });
        fixture = TestBed.createComponent(SettingsHostedDevicesComponent);
        fixture.componentRef.setInput('lanAvailable', true);
        fixture.detectChanges();
        root = fixture.nativeElement;
    });

    afterEach(() => {
        fixture.destroy();
        window.electron = originalElectron;
        jest.useRealTimers();
    });

    it('shows a single-use QR, allows copying it, and requires approval and revocation actions', async () => {
        clickButton('[data-test-id="hosted-device-pair"]');
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(
            root.querySelector('[data-test-id="hosted-device-pair-qr"]')
        ).not.toBeNull();
        clickButton('[data-test-id="hosted-device-copy-link"]');
        expect(copy).toHaveBeenCalledWith(inviteUrl);
        snapshot = { pending: [claim], devices: [] };
        await jest.advanceTimersByTimeAsync(2000);
        fixture.detectChanges();
        expect(
            root.querySelector('[data-test-id="hosted-device-pair-qr"]')
        ).toBeNull();
        expect(root.querySelector('.device-row code')?.textContent).toBe(
            '012345'
        );
        expect(control).not.toHaveBeenCalledWith(
            expect.objectContaining({ action: 'approve' })
        );

        clickButton('.device-row button');
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(control).toHaveBeenCalledWith({
            action: 'approve',
            claimId: claim.claimId,
        });
        expect(root.querySelector('.device-row')?.textContent).toContain(
            'HOSTED_SERVER.REVOKE_DEVICE'
        );
        clickButton('.device-row button');
        expect(control).not.toHaveBeenCalledWith(
            expect.objectContaining({ action: 'revoke' })
        );
        confirm.mock.calls[0][0].onConfirm();
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(control).toHaveBeenCalledWith({
            action: 'revoke',
            deviceId: device.id,
        });
        expect(root.textContent).toContain(
            'HOSTED_SERVER.PAIRED_DEVICES_EMPTY'
        );
    });

    it('keeps device management available when LAN sharing is unavailable', () => {
        fixture.componentRef.setInput('lanAvailable', false);
        fixture.detectChanges();
        expect(
            root.querySelector('[data-test-id="hosted-device-pair"]')
        ).toBeNull();
        expect(
            root.querySelector('button[aria-controls="hosted-device-list"]')
        ).not.toBeNull();
    });

    it('configures, replaces and clears a masked phone approval password only while HTTPS is active', async () => {
        const passwordSelector =
            '[data-test-id="hosted-browser-pairing-password"]';
        const clearSelector = '[data-test-id="hosted-browser-pairing-clear"]';
        expect(root.querySelector(passwordSelector)).toBeNull();
        expect(control).not.toHaveBeenCalledWith({
            action: 'browser-settings',
        });
        fixture.componentRef.setInput('lanAvailable', false);
        fixture.componentRef.setInput(
            'httpsOrigin',
            'https://library.example.test'
        );
        fixture.detectChanges();
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(control).toHaveBeenCalledWith({ action: 'browser-settings' });
        expect(root.querySelector(clearSelector)).toBeNull();

        const input = root.querySelector<HTMLInputElement>(passwordSelector);
        expect(input?.type).toBe('password');
        expect(input?.minLength).toBe(12);
        expect(input?.maxLength).toBe(128);
        if (!input?.form) throw new Error('Missing password form');
        for (const password of [
            'synthetic-passphrase',
            'updated-synthetic-password',
        ]) {
            input.value = password;
            input.form.dispatchEvent(new Event('submit', { cancelable: true }));
            expect(input.value).toBe('');
            await jest.advanceTimersByTimeAsync(0);
            fixture.detectChanges();
            expect(control).toHaveBeenCalledWith({
                action: 'set-browser-password',
                password,
            });
            expect(root.textContent).toContain(
                'HOSTED_SERVER.PHONE_PASSWORD_SAVED'
            );
            expect(root.textContent).not.toContain(password);
        }

        clickButton(clearSelector);
        expect(control).not.toHaveBeenCalledWith({
            action: 'set-browser-password',
            password: null,
        });
        confirm.mock.calls[0][0].onConfirm();
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(control).toHaveBeenCalledWith({
            action: 'set-browser-password',
            password: null,
        });
        expect(root.textContent).toContain(
            'HOSTED_SERVER.PHONE_PASSWORD_CLEARED'
        );
        expect(root.querySelector(clearSelector)).toBeNull();

        fixture.componentRef.setInput('httpsOrigin', undefined);
        fixture.detectChanges();
        expect(root.querySelector(passwordSelector)).toBeNull();
    });
});
