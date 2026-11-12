import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
    HostedCloudflareCommand,
    HostedCloudflareStatus,
    HostedServerCommand,
    HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsHostedServerComponent } from './settings-hosted-server.component';

const address = '192.168.40.5';
const otherAddress = '192.168.40.6';
const localUrl = 'http://127.0.0.1:4334';
const lanUrl = `http://${address}:4334`;
const httpsOrigin = 'https://library.example.test';
const connectorStopped: HostedCloudflareStatus = {
    state: 'stopped',
    savedToken: false,
    secureStorage: true,
};
const connectorRunning: HostedCloudflareStatus = {
    ...connectorStopped,
    state: 'running',
    savedToken: true,
};

describe('hosted server settings', () => {
    const originalElectron = window.electron;
    const control = jest.fn<
        Promise<HostedServerStatus>,
        [HostedServerCommand]
    >();
    const accessCode = jest.fn<Promise<string>, []>();
    const connector = jest.fn<
        Promise<HostedCloudflareStatus>,
        [HostedCloudflareCommand]
    >();
    const copy = jest.fn();
    let fixture: ComponentFixture<SettingsHostedServerComponent>;
    let component: SettingsHostedServerComponent;

    beforeEach(() => {
        jest.resetAllMocks();
        jest.useFakeTimers();
        window.electron = {
            hostedServerControl: control,
            hostedServerAccessCode: accessCode,
        } as unknown as typeof window.electron;
        control.mockResolvedValue({
            state: 'stopped',
            availableAddresses: [address, otherAddress],
        });
        TestBed.configureTestingModule({
            imports: [SettingsHostedServerComponent, TranslateModule.forRoot()],
            providers: [{ provide: Clipboard, useValue: { copy } }],
        });
        fixture = TestBed.createComponent(SettingsHostedServerComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
        window.electron = originalElectron;
        jest.useRealTimers();
    });

    it('defaults to Home network and binds its address when Start is clicked', async () => {
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(
            root.querySelector<HTMLInputElement>(
                '[data-test-id="hosted-access-method"] input[value="computer"]'
            )?.checked
        ).toBeUndefined();
        expect(
            root.querySelector<HTMLInputElement>(
                '[data-test-id="hosted-access-method"] input[value="lan"]'
            )?.checked
        ).toBe(true);
        expect(component.address()).toBe(address);
        control.mockResolvedValueOnce({ state: 'running', localUrl, lanUrl });
        component.start();
        component.start();
        expect(control.mock.calls).toEqual([
            ['status'],
            [{ start: true, lanAddress: address }],
        ]);
        await jest.advanceTimersByTimeAsync(0);
        expect(component.status()).toMatchObject({
            state: 'running',
            localUrl,
            lanUrl,
        });
    });

    it('offers an explicit restart before sharing a running computer-only server and shows the LAN QR', async () => {
        control.mockResolvedValueOnce({
            state: 'running',
            localUrl,
            availableAddresses: [address],
        });
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('qrcode')).toBeNull();
        root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-server-share-lan"]'
        )?.click();
        fixture.detectChanges();
        expect(control.mock.calls).toEqual([['status']]);
        expect(root.textContent).toContain('HOSTED_SERVER.LAN_RESTART_NOTICE');
        control.mockResolvedValueOnce({
            state: 'running',
            localUrl,
            lanUrl,
            lanAddress: address,
            availableAddresses: [address],
        });
        root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-server-restart-lan"]'
        )?.click();
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(control.mock.calls).toEqual([
            ['status'],
            [{ restart: true, lanAddress: address }],
        ]);
        expect(
            root.querySelector('[data-test-id="hosted-server-address"]')
                ?.textContent
        ).toContain(lanUrl);
        expect(
            root.querySelector('[data-test-id="hosted-server-lan-qr"]')
        ).not.toBeNull();
    });

    it('reports a rejected restart and keeps the live server status', async () => {
        const running = {
            state: 'running',
            localUrl,
            availableAddresses: [address],
        } satisfies HostedServerStatus;
        control
            .mockResolvedValueOnce(running)
            .mockRejectedValueOnce(new Error('synthetic interface change'))
            .mockResolvedValueOnce(running);
        await jest.advanceTimersByTimeAsync(0);
        component.lanSetup.set(true);
        component.restartForLan();
        await jest.advanceTimersByTimeAsync(0);
        expect(component.status()).toEqual(running);
        expect(component.feedback()).toBe('HOSTED_SERVER.LAN_RESTART_FAILED');
    });

    it('keeps active HTTPS independent and never renders a loopback QR', async () => {
        await jest.advanceTimersByTimeAsync(0);
        component.status.set({
            state: 'running',
            localUrl,
            lanUrl: localUrl,
            httpsOrigin: 'https://localhost',
            availableAddresses: [address],
        });
        component.lanSetup.set(true);
        component.qrAddress.set('https://localhost');
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('qrcode')).toBeNull();
        expect(root.textContent).toContain('HOSTED_SERVER.LAN_RESTART_HTTPS');
        component.restartForLan();
        expect(control.mock.calls).toEqual([['status']]);
    });

    it('uses the chosen address for LAN hosting and waits for an interface to be available', async () => {
        control.mockResolvedValueOnce({
            state: 'stopped',
            availableAddresses: [],
        });
        await jest.advanceTimersByTimeAsync(0);
        component.accessChoice.set('lan');
        component.start();
        expect(control.mock.calls).toEqual([['status']]);
        await jest.advanceTimersByTimeAsync(3000);
        component.addressChoice.set(otherAddress);
        control.mockResolvedValueOnce({
            state: 'running',
            lanAddress: otherAddress,
        });
        component.start();
        expect(control).toHaveBeenLastCalledWith({
            start: true,
            lanAddress: otherAddress,
        });
        await jest.advanceTimersByTimeAsync(0);
        expect(component.status()).toMatchObject({
            state: 'running',
            lanAddress: otherAddress,
        });
    });

    it('ignores a late poll after starting and clears the access code after the server goes offline', async () => {
        let resolveOldStatus!: (status: HostedServerStatus) => void;
        control.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveOldStatus = resolve;
            })
        );
        await jest.advanceTimersByTimeAsync(0);
        control.mockResolvedValueOnce({ state: 'running', localUrl, lanUrl });
        await component.control({ start: true });
        resolveOldStatus({ state: 'stopped' });
        await jest.advanceTimersByTimeAsync(0);
        expect(component.status().state).toBe('running');
        accessCode.mockResolvedValueOnce('synthetic-code');
        await component.showCode();
        expect(component.code()).toBe('synthetic-code');
        control.mockResolvedValueOnce({ state: 'stopped' });
        await jest.advanceTimersByTimeAsync(3000);
        expect(component.status().state).toBe('stopped');
        expect(component.code()).toBe('');
    });

    it('reports IPC errors and recovers on a later poll', async () => {
        control.mockRejectedValueOnce(new Error('synthetic bridge error'));
        await jest.advanceTimersByTimeAsync(0);
        expect(component.status()).toEqual({
            state: 'error',
            error: 'startup',
        });
        control.mockRejectedValueOnce(new Error('synthetic start failure'));
        await component.control({ start: true });
        expect(component.busy()).toBe(false);
        expect(component.status()).toEqual({
            state: 'error',
            error: 'startup',
        });
        await jest.advanceTimersByTimeAsync(3000);
        expect(component.status().state).toBe('stopped');
    });

    it('enables HTTPS alongside LAN and rejects credentials and paths before IPC', async () => {
        await jest.advanceTimersByTimeAsync(0);
        component.status.set({ state: 'running', localUrl, lanUrl });
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-https-setup"]'
        )?.click();
        fixture.detectChanges();
        component.httpsAddress.set('https://user:secret@library.example.test');
        fixture.detectChanges();
        root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-https-start"]'
        )?.click();
        expect(component.httpsInvalid()).toBe(true);
        expect(control).toHaveBeenCalledTimes(1);
        component.httpsAddress.set('https://library.example.test/');
        control.mockResolvedValueOnce({
            state: 'running',
            localUrl,
            lanUrl,
            httpsOrigin: 'https://library.example.test',
        });
        component.enableHttps();
        expect(component.status().state).toBe('running');
        await jest.advanceTimersByTimeAsync(0);
        expect(control).toHaveBeenLastCalledWith({
            httpsOrigin: 'https://library.example.test',
        });
        expect(component.status().lanUrl).toBe(lanUrl);
        control.mockResolvedValueOnce({
            state: 'running',
            localUrl,
            lanUrl,
            httpsOrigin: '',
        });
        fixture.detectChanges();
        root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-https-stop"]'
        )?.click();
        await jest.advanceTimersByTimeAsync(0);
        expect(control).toHaveBeenLastCalledWith({ httpsOrigin: '' });
        expect(component.status().lanUrl).toBe(lanUrl);
    });

    it('offers one access picker and shows setup for the selected method', async () => {
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const start = root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-server-start"]'
        );
        const method = root.querySelector<HTMLInputElement>(
            '[data-test-id="hosted-access-method"] input[value="https"]'
        );
        expect(root.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
        expect(
            Array.from(
                root.querySelectorAll<HTMLInputElement>('input[type="radio"]')
            ).map((input) => input.value)
        ).toEqual(['lan', 'https']);
        expect(
            root.querySelector<HTMLInputElement>('input[value="lan"]')?.checked
        ).toBe(true);
        expect(root.querySelector('details')).toBeNull();
        expect(start?.disabled).toBe(false);
        expect(
            root.querySelector('[data-test-id="hosted-https-origin"]')
        ).toBeNull();
        root.querySelector<HTMLInputElement>('input[value="lan"]')?.click();
        fixture.detectChanges();
        expect(root.textContent).toContain('HOSTED_SERVER.LAN_WARNING');
        expect(method?.getAttribute('aria-describedby')).toBe(
            'hosted-description-https'
        );
        method?.click();
        fixture.detectChanges();
        expect(root.textContent).not.toContain('HOSTED_SERVER.LAN_WARNING');
        expect(
            root.querySelectorAll('input[type="radio"]:checked')
        ).toHaveLength(1);
        expect(method?.checked).toBe(true);
        expect(start?.disabled).toBe(true);
        expect(
            root.querySelector('[data-test-id="hosted-https-origin"]')
        ).not.toBeNull();
        component.httpsAddress.set('http://library.example.test');
        fixture.detectChanges();
        start?.click();
        fixture.detectChanges();
        expect(control.mock.calls).toEqual([['status']]);
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(
            'HOSTED_SERVER.HTTPS_INVALID'
        );
    });

    it('starts Custom HTTPS on loopback even with a saved LAN address and keeps the local server after HTTPS fails', async () => {
        control.mockResolvedValueOnce({
            state: 'stopped',
            lanAddress: address,
            availableAddresses: [address],
        });
        await jest.advanceTimersByTimeAsync(0);
        expect(component.accessMethod()).toBe('lan');
        component.accessChoice.set('https');
        component.httpsAddress.set('https://library.example.test/');
        control
            .mockResolvedValueOnce({ state: 'running', localUrl })
            .mockRejectedValueOnce(new Error('synthetic HTTPS error'));
        component.start();
        component.start();
        await jest.advanceTimersByTimeAsync(0);
        expect(control.mock.calls).toEqual([
            ['status'],
            [{ start: true }],
            [{ httpsOrigin: 'https://library.example.test' }],
        ]);
        expect(component.status()).toEqual({
            state: 'running',
            localUrl,
            httpsError: true,
        });
        expect(component.busy()).toBe(false);
    });

    it('waits for the local server before opening an HTTPS origin', async () => {
        await jest.advanceTimersByTimeAsync(0);
        component.accessChoice.set('https');
        component.httpsAddress.set('https://library.example.test');
        control.mockResolvedValueOnce({ state: 'error', error: 'port' });
        component.start();
        await jest.advanceTimersByTimeAsync(0);
        expect(control.mock.calls).toEqual([['status'], [{ start: true }]]);
        expect(component.status()).toEqual({ state: 'error', error: 'port' });
        expect(component.httpsAddress()).toBe('https://library.example.test');
    });

    it('offers the bundled tunnel only when the desktop connector is available', async () => {
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('input[value="cloudflare"]')).toBeNull();

        window.electron.hostedCloudflareControl = connector;
        connector.mockResolvedValue(connectorStopped);
        await jest.advanceTimersByTimeAsync(3000);
        fixture.detectChanges();
        expect(root.querySelector('input[value="cloudflare"]')).not.toBeNull();
    });

    it('requires Access confirmation and a token, then hides remote sharing until sign-in is verified', async () => {
        window.electron.hostedCloudflareControl = connector;
        connector
            .mockResolvedValueOnce(connectorStopped)
            .mockResolvedValueOnce(connectorRunning);
        await jest.advanceTimersByTimeAsync(0);
        component.accessChoice.set('cloudflare');
        component.httpsAddress.set(httpsOrigin);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const start = root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-server-start"]'
        );
        const token = root.querySelector<HTMLInputElement>(
            '[data-test-id="hosted-cloudflare-token"]'
        );
        expect(token?.type).toBe('password');
        expect(start?.disabled).toBe(true);
        component.cloudflareProtected.set(true);
        fixture.detectChanges();
        expect(start?.disabled).toBe(true);
        component.cloudflareToken.set('synthetic-token');
        fixture.detectChanges();
        expect(start?.disabled).toBe(false);

        const originInput = root.querySelector<HTMLInputElement>(
            '[data-test-id="hosted-https-origin"]'
        )!;
        originInput.value = 'https://different-library.example.test';
        originInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(component.cloudflareProtected()).toBe(false);
        expect(start?.disabled).toBe(true);
        component.httpsAddress.set(httpsOrigin);
        component.cloudflareProtected.set(true);
        fixture.detectChanges();

        control
            .mockResolvedValueOnce({ state: 'running', localUrl })
            .mockResolvedValueOnce({
                state: 'running',
                localUrl,
                httpsOrigin,
            });
        start?.click();
        await jest.advanceTimersByTimeAsync(0);
        component.qrAddress.set(httpsOrigin);
        fixture.detectChanges();
        expect(control.mock.calls).toEqual([
            ['status'],
            [{ start: true }],
            [{ httpsOrigin }],
        ]);
        expect(connector.mock.calls).toEqual([
            ['status'],
            [{ start: true, token: 'synthetic-token' }],
        ]);
        expect(component.cloudflareToken()).toBe('');
        expect(
            root.querySelector('[data-test-id="hosted-server-address"]')
        ).toBeNull();
        expect(
            root.querySelector('[data-test-id="hosted-https-address"]')
        ).toBeNull();
        expect(
            root.querySelector('[data-test-id="hosted-server-https-qr"]')
        ).toBeNull();
        component.qrAddress.set('');
        root.querySelector<HTMLInputElement>(
            '[data-test-id="hosted-cloudflare-verified"] input'
        )?.click();
        fixture.detectChanges();
        expect(
            root.querySelector('[data-test-id="hosted-https-address"]')
        ).not.toBeNull();

        connector.mockResolvedValueOnce({
            ...connectorRunning,
            state: 'error',
        });
        control.mockResolvedValueOnce({
            state: 'running',
            localUrl,
            httpsOrigin,
        });
        await jest.advanceTimersByTimeAsync(3000);
        fixture.detectChanges();
        expect(component.cloudflareVerified()).toBe(false);
        expect(
            root.querySelector('[data-test-id="hosted-https-address"]')
        ).toBeNull();
    });

    it('closes Cloudflare HTTPS after a connector start failure and preserves LAN access', async () => {
        window.electron.hostedCloudflareControl = connector;
        connector
            .mockResolvedValueOnce({
                ...connectorStopped,
                savedToken: true,
            })
            .mockRejectedValueOnce(new Error('private bridge error'));
        await jest.advanceTimersByTimeAsync(0);
        component.status.set({ state: 'running', localUrl, lanUrl });
        component.accessChoice.set('cloudflare');
        component.httpsAddress.set(httpsOrigin);
        component.cloudflareProtected.set(true);
        control
            .mockResolvedValueOnce({
                state: 'running',
                localUrl,
                lanUrl,
                httpsOrigin,
            })
            .mockResolvedValueOnce({ state: 'running', localUrl, lanUrl });

        component.enableHttps();
        await jest.advanceTimersByTimeAsync(0);
        expect(connector).toHaveBeenLastCalledWith({ start: true });
        expect(control.mock.calls).toEqual([
            ['status'],
            [{ httpsOrigin }],
            [{ httpsOrigin: '' }],
        ]);
        expect(component.status()).toEqual({
            state: 'running',
            localUrl,
            lanUrl,
        });
        expect(component.cloudflareError()).toBe(
            'HOSTED_SERVER.CLOUDFLARE_FAILED'
        );
    });

    it('keeps the code hidden after toggling it off and reports failures without exposing details', async () => {
        accessCode.mockResolvedValueOnce('synthetic-code');
        await component.showCode();
        expect(component.code()).toBe('synthetic-code');
        await component.showCode();
        expect(component.code()).toBe('');
        expect(accessCode).toHaveBeenCalledTimes(1);
        accessCode.mockRejectedValueOnce(new Error('synthetic bridge error'));
        await component.showCode();
        expect(component.code()).toBe('');
        expect(component.feedback()).toBe('HOSTED_SERVER.CODE_FAILED');

        copy.mockReturnValueOnce(true).mockReturnValueOnce(false);
        component.copyAddress(lanUrl);
        expect(copy).toHaveBeenCalledWith(lanUrl);
        expect(component.feedback()).toBe('HOSTED_SERVER.ADDRESS_COPIED');
        component.copyAddress(lanUrl);
        expect(component.feedback()).toBe('HOSTED_SERVER.COPY_FAILED');
    });
});
