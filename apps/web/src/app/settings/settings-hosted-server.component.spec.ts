import { Clipboard } from '@angular/cdk/clipboard';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
    HostedServerCommand,
    HostedServerStatus,
} from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsHostedServerComponent } from './settings-hosted-server.component';

const address = '192.168.40.5';
const otherAddress = '192.168.40.6';
const localUrl = 'http://127.0.0.1:4334';
const lanUrl = `http://${address}:4334`;

describe('hosted server settings', () => {
    const originalElectron = window.electron;
    const control = jest.fn<
        Promise<HostedServerStatus>,
        [HostedServerCommand]
    >();
    const accessCode = jest.fn<Promise<string>, []>();
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

    it('starts without exposing the server to the LAN unless the user opts in', async () => {
        await jest.advanceTimersByTimeAsync(0);
        expect(component.address()).toBe(address);
        expect(component.shareLan()).toBe(false);
        control.mockResolvedValueOnce({ state: 'running', localUrl });
        component.start();
        component.start();
        expect(control.mock.calls).toEqual([['status'], [{ start: true }]]);
        await jest.advanceTimersByTimeAsync(0);
        expect(component.status()).toMatchObject({
            state: 'running',
            localUrl,
        });
    });

    it('uses the chosen address for LAN hosting and waits for an interface to be available', async () => {
        control.mockResolvedValueOnce({
            state: 'stopped',
            availableAddresses: [],
        });
        await jest.advanceTimersByTimeAsync(0);
        component.lanChoice.set(true);
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
