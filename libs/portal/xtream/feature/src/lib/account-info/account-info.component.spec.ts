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
import { AccountInfoComponent } from './account-info.component';

describe('AccountInfoComponent', () => {
    let fixture: ComponentFixture<AccountInfoComponent>;
    let component: AccountInfoComponent;
    let xtreamApiService: {
        getAccountInfo: jest.Mock;
    };
    let currentPlaylist: WritableSignal<null>;

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

        await TestBed.configureTestingModule({
            imports: [
                AccountInfoComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
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
});
