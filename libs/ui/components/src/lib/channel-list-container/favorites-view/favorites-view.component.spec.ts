import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Channel } from '@iptvnator/shared/interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { FavoritesViewComponent } from './favorites-view.component';

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

describe('FavoritesViewComponent', () => {
    let fixture: ComponentFixture<FavoritesViewComponent>;
    let component: FavoritesViewComponent;
    let dialog: { open: jest.Mock };

    const primaryChannel = createChannel(
        'channel-1',
        'Favorite One',
        'https://example.com/favorite-one.m3u8'
    );

    beforeEach(async () => {
        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                FavoritesViewComponent,
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

        fixture = TestBed.createComponent(FavoritesViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('favorites', [primaryChannel]);
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

    it('stores context-menu coordinates and opens channel details for the selected favorite', async () => {
        const openMenuSpy = jest
            .spyOn(component.contextMenuTrigger(), 'openMenu')
            .mockImplementation();

        component.onChannelContextMenu(primaryChannel, {
            clientX: 88,
            clientY: 132,
        } as MouseEvent);
        await Promise.resolve();

        expect(component.contextMenuChannel()).toBe(primaryChannel);
        expect(component.contextMenuPosition()).toEqual({
            x: '88px',
            y: '132px',
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
