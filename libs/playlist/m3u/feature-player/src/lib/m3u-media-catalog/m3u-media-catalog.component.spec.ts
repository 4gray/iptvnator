import { TestBed } from '@angular/core/testing';
import type { Channel } from '@iptvnator/shared/interfaces';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { M3uMediaCatalogComponent } from './m3u-media-catalog.component';

function channel(name: string, id: string, group = 'Films'): Channel {
    return {
        id, name,
        url: 'https://example.invalid/' + id + '.mp4',
        group: { title: group },
        tvg: { id: '', name, url: '', logo: '', rec: '' },
        http: { referrer: '', 'user-agent': '', origin: '' },
        radio: 'false',
    };
}

describe('M3U media catalog', () => {
    beforeEach(() => TestBed.configureTestingModule({
        imports: [M3uMediaCatalogComponent],
        providers: [{
            provide: TmdbEnrichmentService,
            useValue: { isEnabled: () => false, enrichMovie: jest.fn() },
        }],
    }));

    it('paginates 62k movies rather than rendering 62k posters, and selects original channels', () => {
        const channels = Array.from({ length: 62243 }, (_, i) =>
            channel('Film ' + i, String(i))
        );
        const fixture = TestBed.createComponent(M3uMediaCatalogComponent);
        fixture.componentRef.setInput('kind', 'movies');
        fixture.componentRef.setInput('channels', channels);
        fixture.detectChanges();
        const cards = fixture.nativeElement.querySelectorAll('button.movie-card');
        expect(cards).toHaveLength(36);
        expect(fixture.componentInstance.moviePages()).toBeGreaterThan(1000);
        const selection = jest.fn();
        fixture.componentInstance.selected.subscribe(selection);
        cards[0].click();
        expect(selection).toHaveBeenCalledWith(channels[0]);
        fixture.destroy();
    });

    it('offers group filtering without modifying playlist input', () => {
        const entries = [channel('First', '1', 'Action'), channel('Second', '2', 'Drama')];
        const fixture = TestBed.createComponent(M3uMediaCatalogComponent);
        fixture.componentRef.setInput('kind', 'movies');
        fixture.componentRef.setInput('channels', entries);
        fixture.detectChanges();
        const group = fixture.nativeElement.querySelector('select[aria-label="Filter catalog by group"]');
        group.value = 'Action';
        group.dispatchEvent(new Event('change'));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('.movie-card')).toHaveLength(1);
        expect(entries[0].name).toBe('First');
        fixture.destroy();
    });

    it('opens series seasons and episodes, preserving the original Channel identity', () => {
        const entries = [
            channel('The Show S02E04', '4'),
            channel('The Show S01E01', '1'),
            channel('The Show S01E02', '2'),
        ];
        const fixture = TestBed.createComponent(M3uMediaCatalogComponent);
        fixture.componentRef.setInput('kind', 'series');
        fixture.componentRef.setInput('channels', entries);
        fixture.detectChanges();
        const card = fixture.nativeElement.querySelector('.series-card') as HTMLButtonElement;
        expect(card).toBeTruthy();
        card.click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('.season-picker button')).toHaveLength(2);
        const selection = jest.fn();
        fixture.componentInstance.selected.subscribe(selection);
        const episode = fixture.nativeElement.querySelector('.episode-list button') as HTMLButtonElement;
        episode.click();
        expect(selection).toHaveBeenCalledWith(entries[1]);
        fixture.destroy();
    });
});