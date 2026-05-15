import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Channel } from '@iptvnator/shared/interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { RecentViewComponent, RecentViewItem } from './recent-view.component';

function createChannel(id: string, name: string, url: string): Channel {
    return {
        id,
        name,
        url,
        group: { title: 'Live' },
        tvg: {
            id,
            name,
            url: '',
            logo: '',
            rec: '',
        },
        http: {
            referrer: '',
            'user-agent': '',
            origin: '',
        },
        radio: 'false',
        epgParams: '',
    };
}

describe('RecentViewComponent', () => {
    let fixture: ComponentFixture<RecentViewComponent>;
    let component: RecentViewComponent;
    let dialog: { open: jest.Mock };

    const primaryChannel = createChannel(
        'channel-1',
        'Recent One',
        'https://example.com/recent-one.m3u8'
    );
    const recentItems: RecentViewItem[] = [
        {
            channel: primaryChannel,
            viewedAt: '2026-04-30T12:00:00.000Z',
        },
    ];

    beforeEach(async () => {
        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                RecentViewComponent,
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

        fixture = TestBed.createComponent(RecentViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('recentItems', recentItems);
        fixture.componentRef.setInput('searchTerm', '');
        fixture.componentRef.setInput('channelEpgMap', new Map<string, null>());
        fixture.componentRef.setInput(
            'channelIconMap',
            new Map<string, string>()
        );
        fixture.componentRef.setInput('progressTick', 0);
        fixture.componentRef.setInput('shouldShowEpg', false);
        fixture.detectChanges();
    });

    it('stores context-menu coordinates and opens channel details for the selected recent channel', async () => {
        const openMenuSpy = jest
            .spyOn(component.contextMenuTrigger(), 'openMenu')
            .mockImplementation();

        component.onChannelContextMenu(primaryChannel, {
            clientX: 104,
            clientY: 156,
        } as MouseEvent);
        await Promise.resolve();

        expect(component.contextMenuChannel()).toBe(primaryChannel);
        expect(component.contextMenuPosition()).toEqual({
            x: '104px',
            y: '156px',
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

    it('emits the selected channel URL when removing from the context menu', async () => {
        const removed = jest.fn();
        component.removeRecent.subscribe(removed);
        jest.spyOn(
            component.contextMenuTrigger(),
            'openMenu'
        ).mockImplementation();

        component.onChannelContextMenu(primaryChannel, {
            clientX: 104,
            clientY: 156,
        } as MouseEvent);
        await Promise.resolve();

        component.removeContextMenuChannel();

        expect(removed).toHaveBeenCalledWith(primaryChannel.url);
    });
});
