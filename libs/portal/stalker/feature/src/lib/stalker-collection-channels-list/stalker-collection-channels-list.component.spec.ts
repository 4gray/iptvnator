import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockPipe } from 'ng-mocks';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelListItemComponent } from '@iptvnator/ui/components';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { StalkerCollectionChannelsListComponent } from './stalker-collection-channels-list.component';

@Component({
    selector: 'app-channel-list-item',
    standalone: true,
    template: '',
})
class StubChannelListItemComponent {
    readonly name = input('');
    readonly logo = input<string | null | undefined>(null);
    readonly selected = input(false);
    readonly epgProgram = input<unknown>(null);
    readonly progressPercentage = input(0);
    readonly showFavoriteButton = input(false);
    readonly showProgramInfoButton = input(false);
    readonly isFavorite = input(false);
    readonly clicked = output<void>();
    readonly favoriteToggled = output<void>();
}

describe('StalkerCollectionChannelsListComponent', () => {
    let fixture: ComponentFixture<StalkerCollectionChannelsListComponent>;
    let component: StalkerCollectionChannelsListComponent;

    const bulkItvEpgByChannel = signal<Record<string, EpgProgram[]>>({});
    const stalkerStore = {
        bulkItvEpgByChannel,
    };

    beforeEach(async () => {
        bulkItvEpgByChannel.set({});

        await TestBed.configureTestingModule({
            imports: [StalkerCollectionChannelsListComponent],
            providers: [
                { provide: StalkerStore, useValue: stalkerStore },
            ],
        })
            .overrideComponent(StalkerCollectionChannelsListComponent, {
                remove: {
                    imports: [ChannelListItemComponent, TranslatePipe],
                },
                add: {
                    imports: [
                        StubChannelListItemComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerCollectionChannelsListComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('items', [
            {
                id: '10001',
                name: 'Alpha TV',
                o_name: 'Alpha TV',
                logo: 'alpha.png',
            },
            {
                id: '10002',
                name: 'Beta TV',
                o_name: 'Beta TV',
                logo: 'beta.png',
            },
        ]);
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('keeps row previews empty until bulk epg has been loaded', () => {
        fixture.detectChanges();

        expect(component.epgPrograms.size).toBe(0);
        expect(component.currentProgramsProgress.size).toBe(0);
    });

    it('derives row previews from cached bulk epg', () => {
        bulkItvEpgByChannel.set({
            '10001': [buildProgram('10001', 'Current Show')],
            '10002': [buildProgram('10002', 'Other Show')],
        });

        fixture.detectChanges();

        expect(component.epgPrograms.get('10001')?.title).toBe('Current Show');
        expect(component.epgPrograms.get('10002')?.title).toBe('Other Show');
    });
});

function buildProgram(channelId: string, title: string): EpgProgram {
    const startTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    const stopTimestamp = startTimestamp + 30 * 60;

    return {
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel: channelId,
        title,
        desc: `${title} description`,
        category: null,
        startTimestamp,
        stopTimestamp,
    };
}
