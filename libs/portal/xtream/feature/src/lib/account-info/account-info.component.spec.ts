import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import {
    XtreamApiService,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { DataService } from '@iptvnator/services';
import { CONNECTIVITY_GUARD_RESET } from '@iptvnator/shared/interfaces';
import { AccountInfoComponent } from './account-info.component';

describe('AccountInfoComponent', () => {
    let fixture: ComponentFixture<AccountInfoComponent>;
    let component: AccountInfoComponent;
    let xtreamApiService: {
        getAccountInfo: jest.Mock;
    };
    let currentPlaylist: WritableSignal<null>;
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(async () => {
        xtreamApiService = {
            getAccountInfo: jest.fn().mockResolvedValue({
                user_info: {
                    active_cons: '0',
                    allowed_output_formats: [],
                    max_connections: '0',
                    status: 'Active',
                    username: 'dialog-user',
                },
                server_info: {
                    server_protocol: 'http',
                    url: 'dialog.example.test',
                },
            }),
        };
        currentPlaylist = signal(null);
        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ success: true }),
        };

        await TestBed.configureTestingModule({
            imports: [
                AccountInfoComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DataService,
                    useValue: dataService,
                },
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        playlist: {
                            id: 'dialog-playlist',
                            title: 'Dialog Xtream',
                            serverUrl: 'https://dialog.example.test',
                            username: 'dialog-user',
                            password: 'dialog-secret',
                        },
                    },
                },
                {
                    provide: XtreamApiService,
                    useValue: xtreamApiService,
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist,
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AccountInfoComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
    });

    it('explains a guard refusal and clears the notice on successful retry', async () => {
        xtreamApiService.getAccountInfo.mockRejectedValueOnce(
            new Error(
                "Error invoking remote method 'XTREAM_REQUEST': Portal https://portal.example is not responding; skipped after repeated connection failures"
            )
        );
        await component.reload();
        fixture.detectChanges();
        expect(component.requestsPaused()).toBe(true);
        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.REQUESTS_PAUSED.TITLE'
        );
        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.REQUESTS_PAUSED.RETRY'
        );
        await component.reload();
        expect(component.requestsPaused()).toBe(false);
        expect(component.loadState()).toBe('ready');
    });

    it('keeps actual network errors distinct from a paused request', async () => {
        xtreamApiService.getAccountInfo.mockRejectedValueOnce(
            new Error('connect ECONNREFUSED')
        );
        await component.reload();
        fixture.detectChanges();
        expect(component.requestsPaused()).toBe(false);
        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.ERROR_VIEW.PORTAL_UNAVAILABLE.TITLE'
        );
    });

    it('loads account info from dialog-supplied playlist credentials', () => {
        expect(xtreamApiService.getAccountInfo).toHaveBeenCalledWith({
            serverUrl: 'https://dialog.example.test',
            username: 'dialog-user',
            password: 'dialog-secret',
        });
        expect(component.loadState()).toBe('ready');
        expect(component.playlistLabel()).toBe('Dialog Xtream');
    });

    it('shows unknown content counts when dashboard does not supply them', () => {
        expect(component.heroStats().map((stat) => stat.value)).toEqual([
            '0/0',
            '-',
            '-',
            '-',
        ]);
    });

    it('treats account status as active regardless of provider casing', () => {
        component.accountInfo.set({
            user_info: {
                active_cons: '0',
                allowed_output_formats: [],
                exp_date: '0',
                max_connections: '0',
                status: 'active',
                username: 'dialog-user',
            },
            server_info: {
                server_protocol: 'http',
                url: 'dialog.example.test',
            },
        });

        expect(component.isActive()).toBe(true);
        expect(component.userDetails()[0]?.tone).toBe('positive');
    });

    it('clears the connectivity guard before the Retry button re-reads the account', async () => {
        // The account request is exactly what a tripped guard fast-fails, so a
        // reset placed after it would leave Retry doing nothing for 30 seconds.
        // The automatic first load deliberately does not reset.
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
        xtreamApiService.getAccountInfo.mockClear();

        await component.reload();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            CONNECTIVITY_GUARD_RESET,
            { url: 'https://dialog.example.test' }
        );
        expect(
            dataService.sendIpcEvent.mock.invocationCallOrder[0]
        ).toBeLessThan(
            xtreamApiService.getAccountInfo.mock.invocationCallOrder[0]
        );
    });
});
