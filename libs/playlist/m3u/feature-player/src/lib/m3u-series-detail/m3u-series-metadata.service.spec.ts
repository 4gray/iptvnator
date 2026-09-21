import { TestBed } from '@angular/core/testing';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { M3uSeriesMetadataService } from './m3u-series-metadata.service';

const series = (
    overrides: Partial<{
        key: string;
        title: string;
        yearHint: number | null;
    }> = {}
) => ({
    key: 'pl-1\u0000\u0000dark',
    title: 'Dark',
    yearHint: null,
    ...overrides,
});

describe('M3uSeriesMetadataService', () => {
    const tmdb = { isEnabled: jest.fn(), enrichTv: jest.fn() };
    let service: M3uSeriesMetadataService;

    beforeEach(() => {
        tmdb.isEnabled.mockReset().mockReturnValue(true);
        tmdb.enrichTv.mockReset().mockResolvedValue({ name: 'Dark' });

        TestBed.configureTestingModule({
            providers: [
                M3uSeriesMetadataService,
                { provide: TmdbEnrichmentService, useValue: tmdb },
            ],
        });
        service = TestBed.inject(M3uSeriesMetadataService);
    });

    it('reports a match once the lookup settles', async () => {
        service.load(series());
        await Promise.resolve();

        expect(service.state().status).toBe('matched');
        expect(service.state().details?.name).toBe('Dark');
    });

    it('sends the display title, not the tagged one', async () => {
        // "TR:MODERN FAMILY" is not a show TMDB has ever heard of; the
        // aggregator already removed the tag, and that is what goes out.
        service.load(series({ title: 'MODERN FAMILY', yearHint: 2009 }));

        expect(tmdb.enrichTv).toHaveBeenCalledWith({
            title: 'MODERN FAMILY',
            year: 2009,
        });
    });

    it('does not repeat a lookup for the series already loaded', async () => {
        service.load(series());
        await Promise.resolve();
        service.load(series());

        expect(tmdb.enrichTv).toHaveBeenCalledTimes(1);
    });

    it('stays out of the way when enrichment is disabled', () => {
        tmdb.isEnabled.mockReturnValue(false);

        service.load(series());

        expect(tmdb.enrichTv).not.toHaveBeenCalled();
        expect(service.state().status).toBe('none');
    });

    it('asks nothing for a series with no title', () => {
        service.load(series({ title: '   ' }));

        expect(tmdb.enrichTv).not.toHaveBeenCalled();
        expect(service.state().status).toBe('none');
    });

    it('settles to none when the lookup fails', async () => {
        tmdb.enrichTv.mockRejectedValue(new Error('offline'));

        service.load(series());
        await Promise.resolve();
        await Promise.resolve();

        expect(service.state().status).toBe('none');
        expect(service.state().details).toBeNull();
    });

    it('drops a response for a series the viewer left', async () => {
        // Otherwise the previous show's plot lands on the page now open.
        let settleFirst: ((value: unknown) => void) | undefined;
        tmdb.enrichTv
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    settleFirst = resolve;
                })
            )
            .mockResolvedValueOnce({ name: 'Severance' });

        service.load(series({ key: 'first', title: 'Dark' }));
        service.load(series({ key: 'second', title: 'Severance' }));
        await Promise.resolve();

        // The first lookup answers only now, after the viewer moved on.
        settleFirst?.({ name: 'Dark' });
        await Promise.resolve();
        await Promise.resolve();

        expect(service.state().lookupKey).toBe('second');
        expect(service.state().details?.name).toBe('Severance');
    });
});
