import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Channel } from 'shared-interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { AllChannelsViewComponent } from './all-channels-view.component';

function createChannel(id: string, name: string, url: string): Channel {
    return {
        epgParams: '',
        group: {
            title: 'News',
        },
        http: {
            origin: '',
            referrer: '',
            'user-agent': '',
        },
        id,
        name,
        radio: 'false',
        tvg: {
            id: `${id}-tvg`,
            logo: '',
            name,
            rec: '7',
            url: '',
        },
        url,
        catchup: {
            days: '7',
            type: 'shift',
        },
    } as Channel;
}

describe('AllChannelsViewComponent', () => {
    let fixture: ComponentFixture<AllChannelsViewComponent>;
    let component: AllChannelsViewComponent;
    let dialog: { open: jest.Mock };

    const primaryChannel = createChannel(
        'channel-1',
        'News One',
        'https://example.com/news-one.m3u8'
    );

    beforeEach(async () => {
        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                AllChannelsViewComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AllChannelsViewComponent);
        component = fixture.componentInstance;

        fixture.componentRef.setInput('channels', [primaryChannel]);
        fixture.componentRef.setInput('searchTerm', '');
        fixture.componentRef.setInput('channelEpgMap', new Map<string, null>());
        fixture.componentRef.setInput('progressTick', 0);
        fixture.componentRef.setInput('shouldShowEpg', false);
        fixture.componentRef.setInput('itemSize', 48);
        fixture.componentRef.setInput('favoriteIds', new Set<string>());
        fixture.detectChanges();
    });

    it('stores viewport coordinates for the context menu and opens the dialog for that channel', async () => {
        const openMenuSpy = jest
            .spyOn(component.contextMenuTrigger(), 'openMenu')
            .mockImplementation();

        component.onChannelContextMenu(
            primaryChannel,
            {
                clientX: 144,
                clientY: 188,
            } as MouseEvent
        );
        await Promise.resolve();

        expect(component.contextMenuChannel()).toBe(primaryChannel);
        expect(component.contextMenuPosition()).toEqual({
            x: '144px',
            y: '188px',
        });
        expect(openMenuSpy).toHaveBeenCalled();

        component.openChannelDetails();

        expect(dialog.open).toHaveBeenCalledWith(
            ChannelDetailsDialogComponent,
            expect.objectContaining({
                data: primaryChannel,
                maxWidth: '720px',
                width: 'calc(100vw - 32px)',
            })
        );
    });
});
