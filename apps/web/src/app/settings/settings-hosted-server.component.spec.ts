import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
    HostedCloudflareStatus,
    HostedServerMode,
    HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsHostedServerComponent } from './settings-hosted-server.component';

const address = '192.168.40.5';
const origin = 'https://library.example.test';
const lanUrl = 'http://192.168.40.5:4334';
const tls = {
    certificatePath: '/fixtures/cert.pem',
    keyPath: '/fixtures/key.pem',
};
const tunnel = {
    mode: 'cloudflare',
    origin,
    ...tls,
    team: 'example-team',
    audience: 'a'.repeat(64),
    managed: true,
} satisfies HostedServerMode;

describe('hosted server settings', () => {
    const originalElectron = window.electron;
    const control = jest.fn();
    const connector = jest.fn();
    const copy = jest.fn();
    const devices = jest.fn();
    const getPathForFile = jest.fn();
    let fixture: ComponentFixture<SettingsHostedServerComponent>;
    let component: SettingsHostedServerComponent;
    let root: HTMLElement;

    function setStatus(status: HostedServerStatus): void {
        control.mockResolvedValue(status);
        component.status.set(status);
        fixture.detectChanges();
    }

    beforeEach(async () => {
        jest.resetAllMocks();
        jest.useFakeTimers();
        window.electron = {
            hostedServerControl: control,
            hostedCloudflareControl: connector,
            hostedDeviceControl: devices,
            getPathForFile,
        } as unknown as typeof window.electron;
        control.mockResolvedValue({
            state: 'stopped',
            availableAddresses: [address],
        });
        connector.mockResolvedValue({
            state: 'stopped',
            savedToken: false,
            secureStorage: true,
        } satisfies HostedCloudflareStatus);
        devices.mockResolvedValue({ passwordConfigured: false });
        TestBed.configureTestingModule({
            imports: [SettingsHostedServerComponent, TranslateModule.forRoot()],
            providers: [{ provide: Clipboard, useValue: { copy } }],
        });
        fixture = TestBed.createComponent(SettingsHostedServerComponent);
        component = fixture.componentInstance;
        root = fixture.nativeElement;
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        window.electron = originalElectron;
        jest.useRealTimers();
    });

    it('starts Home network with required pairing and leaves the QR closed', async () => {
        expect(component.mode()).toBe('lan');
        const running = { state: 'running', mode: 'lan', endpoint: lanUrl };
        control.mockResolvedValue(running);
        await Promise.all([component.start(), component.start()]);
        expect(
            control.mock.calls.filter(
                ([command]) => typeof command === 'object'
            )
        ).toEqual([
            [
                {
                    start: true,
                    configuration: { mode: 'lan', address, access: 'paired' },
                },
            ],
        ]);
        fixture.detectChanges();
        expect(
            root.querySelector('[data-test-id="hosted-device-pair"]')
        ).not.toBeNull();
        expect(
            root.querySelector('[data-test-id="hosted-server-active-mode"]')
                ?.textContent
        ).toContain('HOSTED_SERVER.HOME_NETWORK');
        expect(root.querySelector('qrcode')).toBeNull();
    });

    it('keeps saved profiles and unsaved edits across mode changes and navigation', async () => {
        setStatus({
            state: 'stopped',
            configuration: { mode: 'lan', address, access: 'paired' },
            lanAddress: address,
            savedConfigurations: { cloudflare: tunnel },
        });
        component.selectMode('cloudflare');
        expect(component.origin()).toBe(origin);
        expect(component.team()).toBe(tunnel.team);
        component.selectMode('https');
        expect(component.origin()).toBe('');
        expect(component.address()).toBe('');
        component.address.set('192.168.40.10');
        component.origin.set('https://custom.example.test');
        component.certificate.set(tls.certificatePath);
        component.selectMode('cloudflare');
        expect(component.origin()).toBe(origin);
        expect(component.audience()).toBe(tunnel.audience);
        component.selectMode('https');
        expect(component.origin()).toBe('https://custom.example.test');
        expect(component.address()).toBe('192.168.40.10');
        expect(component.certificate()).toBe(tls.certificatePath);
        component.selectMode('lan');
        expect(component.address()).toBe(address);
        component.selectMode('https');
        fixture.destroy();
        fixture = TestBed.createComponent(SettingsHostedServerComponent);
        component = fixture.componentInstance;
        await jest.advanceTimersByTimeAsync(0);
        expect(component.mode()).toBe('https');
        expect(component.origin()).toBe('https://custom.example.test');
        component.selectMode('cloudflare');
        expect(component.team()).toBe(tunnel.team);
    });

    it('sets the certificate and key independently from the file pickers', () => {
        component.selectMode('https');
        fixture.detectChanges();
        const files = root.querySelectorAll<HTMLInputElement>('input[type="file"]');
        expect(files).toHaveLength(2);
        for (const [index, path] of [tls.certificatePath, tls.keyPath].entries()) {
            Object.defineProperty(files[index], 'files', {
                value: [new File([], 'selected.pem')],
                configurable: true,
            });
            getPathForFile.mockReturnValueOnce(path);
            files[index].dispatchEvent(new Event('change'));
        }
        expect(component.certificate()).toBe(tls.certificatePath);
        expect(component.key()).toBe(tls.keyPath);
        Object.defineProperty(files[1], 'files', { value: [] });
        files[1].dispatchEvent(new Event('change'));
        expect(component.key()).toBe(tls.keyPath);
    });

    it('selects a server mode from the cards', () => {
        const picker = root.querySelector('[data-test-id="hosted-access-method"]')!;
        const cards = picker.querySelectorAll<HTMLInputElement>('input[type="radio"]');
        expect(cards).toHaveLength(3);
        expect(cards[0].checked).toBe(true);
        cards[2].click();
        fixture.detectChanges();
        expect(component.mode()).toBe('cloudflare');
        expect(root.querySelector('[data-test-id="hosted-certificate-path"]')).toBeNull();
        cards[1].click();
        fixture.detectChanges();
        expect(component.mode()).toBe('https');
        expect(root.querySelector('[data-test-id="hosted-certificate-path"]')).not.toBeNull();
    });

    it('offers the saved Custom HTTPS profile when the previous mode was the retired proxy', async () => {
        fixture.destroy();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [SettingsHostedServerComponent, TranslateModule.forRoot()],
            providers: [{ provide: Clipboard, useValue: { copy } }],
        });
        control.mockResolvedValue({
            state: 'stopped',
            configuration: {
                mode: 'proxy',
                address: '',
                origin: 'https://retired.example.test',
                certificatePath: '',
                keyPath: '',
            },
            savedConfigurations: { https: { mode: 'https', address, origin, ...tls } },
        } satisfies HostedServerStatus);
        fixture = TestBed.createComponent(SettingsHostedServerComponent);
        component = fixture.componentInstance;
        await jest.advanceTimersByTimeAsync(0);
        expect(component.mode()).toBe('https');
        expect(component.origin()).toBe(origin);
        expect(component.address()).toBe(address);
        expect(component.certificate()).toBe(tls.certificatePath);
    });

    it('always requires pairing when serving on a LAN address', async () => {
        component.address.set(address);
        await component.start();
        expect(control).toHaveBeenCalledWith({
            start: true,
            configuration: { mode: 'lan', address, access: 'paired' },
        });
    });

    it('validates HTTPS settings and submits the complete configuration once', async () => {
        component.mode.set('https');
        component.origin.set('https://user:secret@library.example.test');
        expect(component.canSubmit()).toBe(false);
        component.certificate.set(tls.certificatePath);
        component.key.set(tls.keyPath);
        await component.start();
        expect(component.error()).toBe('HOSTED_SERVER.HTTPS_INVALID');
        expect(control).toHaveBeenCalledTimes(1);
        component.origin.set(origin + '/');
        await component.start();
        expect(control).toHaveBeenCalledWith({
            start: true,
            configuration: { mode: 'https', address, origin, ...tls },
        });
    });

    it('passes managed tunnel settings with the token in the start action and clears the input', async () => {
        component.mode.set(tunnel.mode);
        component.origin.set(tunnel.origin);
        component.team.set(tunnel.team);
        component.audience.set(tunnel.audience);
        component.managed.set(true);
        expect(component.canSubmit()).toBe(false);
        component.token.set('synthetic-token');
        expect(component.canSubmit()).toBe(true);
        await component.start();
        expect(control).toHaveBeenCalledWith({
            start: true,
            configuration: { ...tunnel, certificatePath: '', keyPath: '' },
            connectorToken: 'synthetic-token',
        });
        expect(component.token()).toBe('');
        expect(
            connector.mock.calls.every(([command]) => command === 'status')
        ).toBe(true);
    });

    it('shows why Cloudflare pairing is disabled and enables it after verification', () => {
        setStatus({
            state: 'running',
            mode: 'cloudflare',
            endpoint: origin,
            publicRoute: 'unverified',
        });
        const pair = () => root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-device-pair"]'
        );
        expect(pair()?.disabled).toBe(true);
        expect(root.querySelector('#hosted-pairing-unavailable')?.textContent)
            .toContain('HOSTED_SERVER.ROUTE_unverified');
        pair()?.click();
        expect(devices).not.toHaveBeenCalled();
        expect(
            root.querySelector('[data-test-id="hosted-server-active-mode"]')
                ?.textContent
        ).toContain('HOSTED_SERVER.TUNNEL');
        setStatus({
            state: 'running',
            mode: 'cloudflare',
            endpoint: origin,
            publicRoute: 'access-protected',
        });
        expect(pair()?.disabled).toBe(false);
        expect(root.querySelector('#hosted-pairing-unavailable')).toBeNull();
        expect(root.querySelector('qrcode')).toBeNull();
        expect(devices).not.toHaveBeenCalled();
    });

    it('asks for a private network when the local-only server has no available addresses', () => {
        setStatus({ state: 'running', mode: 'lan' });
        expect(root.textContent).toContain('HOSTED_SERVER.PC_ONLY');
        expect(root.textContent).toContain('HOSTED_SERVER.NO_ADDRESS');
        expect(
            root.querySelector('[data-test-id="hosted-server-share-lan"]')
        ).toBeNull();
        expect(
            root.querySelector('[data-test-id="hosted-device-pair"]')
        ).toBeNull();
    });

    it('restarts a local-only server with required pairing after an explicit address selection', async () => {
        setStatus({
            state: 'running',
            mode: 'lan',
            availableAddresses: [address],
        });
        const disclosure = root.querySelector<HTMLElement>(
            '[data-test-id="hosted-server-share-lan"]'
        );
        expect(disclosure?.textContent).toContain(
            'HOSTED_SERVER.LAN_SHARE_ACTION'
        );
        disclosure!.click();
        const restart = root.querySelector<HTMLButtonElement>(
            '[data-test-id="hosted-server-restart-share"]'
        )!;
        expect(restart.disabled).toBe(true);
        expect(restart.closest('details')?.textContent).toContain(
            'HOSTED_SERVER.LAN_RESTART_NOTICE'
        );

        component.lanShareAddress.set(address);
        fixture.detectChanges();
        expect(restart.disabled).toBe(false);
        control.mockResolvedValue({
            state: 'running',
            mode: 'lan',
            endpoint: lanUrl,
        });
        restart.click();
        await jest.advanceTimersByTimeAsync(0);
        fixture.detectChanges();

        expect(control).toHaveBeenCalledWith({
            start: true,
            configuration: { mode: 'lan', address, access: 'paired' },
        });
        expect(
            root.querySelector('[data-test-id="hosted-device-pair"]')
        ).not.toBeNull();
        expect(root.querySelector('qrcode')).toBeNull();
    });

    it('can disable autostart after a startup error', async () => {
        setStatus({ state: 'error', error: 'port', autoStart: true });
        const button = Array.from(root.querySelectorAll('button')).find(
            (entry) =>
                entry.textContent?.includes('HOSTED_SERVER.DISABLE_AUTOSTART')
        );
        expect(button).toBeDefined();
        button!.click();
        expect(control).toHaveBeenCalledWith('stop');
        await jest.advanceTimersByTimeAsync(0);
    });

    it('reports address copy failures without exposing details', () => {
        copy.mockReturnValueOnce(true).mockReturnValueOnce(false);
        component.copyAddress(lanUrl);
        expect(copy).toHaveBeenCalledWith(lanUrl);
        expect(component.feedback()).toBe('HOSTED_SERVER.ADDRESS_COPIED');
        component.copyAddress(lanUrl);
        expect(component.feedback()).toBe('HOSTED_SERVER.COPY_FAILED');
    });
});
