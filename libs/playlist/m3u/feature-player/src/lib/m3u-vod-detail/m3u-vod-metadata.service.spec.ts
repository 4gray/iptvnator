import { TestBed } from '@angular/core/testing';
import { TmdbEnrichmentService } from '@iptvnator/services';
import { M3uVodMetadataService } from './m3u-vod-metadata.service';

describe('M3uVodMetadataService', () => {
    let service: M3uVodMetadataService;
    let enrichMovie: jest.Mock;
    let isEnabled: jest.Mock;

    /** Deferred promise so tests control exactly when a lookup settles. */
    const deferred = <T>() => {
        let resolve!: (value: T) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };

    const flush = () => new Promise<void>((res) => setTimeout(res, 0));

    beforeEach(() => {
        enrichMovie = jest.fn();
        isEnabled = jest.fn().mockReturnValue(true);

        TestBed.configureTestingModule({
            providers: [
                M3uVodMetadataService,
                {
                    provide: TmdbEnrichmentService,
                    useValue: { enrichMovie, isEnabled },
                },
            ],
        });
        service = TestBed.inject(M3uVodMetadataService);
    });

    it('resolves a match and exposes the details', async () => {
        const details = { id: 42, title: 'Dune' };
        enrichMovie.mockResolvedValue(details);

        service.load({ id: 'ch1', name: 'Dune (2021) 1080p' });
        expect(service.state().status).toBe('loading');

        await flush();
        expect(service.state()).toEqual({
            channelId: 'ch1',
            status: 'matched',
            details,
        });
    });

    it('passes the raw name and the release-tag year to the resolver', () => {
        enrichMovie.mockResolvedValue(null);

        service.load({ id: 'ch1', name: 'Dune (2021) 1080p' });

        expect(enrichMovie).toHaveBeenCalledWith({
            title: 'Dune (2021) 1080p',
            year: 2021,
        });
    });

    it('never reads a year that is part of the film name', () => {
        enrichMovie.mockResolvedValue(null);

        service.load({ id: 'ch1', name: '2001: A Space Odyssey' });

        expect(enrichMovie).toHaveBeenCalledWith({
            title: '2001: A Space Odyssey',
            year: null,
        });
    });

    it('reports "none" when the resolver finds no confident match', async () => {
        enrichMovie.mockResolvedValue(null);

        service.load({ id: 'ch1', name: 'Some Obscure Movie' });
        await flush();

        expect(service.state().status).toBe('none');
        expect(service.state().details).toBeNull();
    });

    it('reports "none" when the lookup rejects', async () => {
        enrichMovie.mockRejectedValue(new Error('offline'));

        service.load({ id: 'ch1', name: 'Dune' });
        await flush();

        expect(service.state().status).toBe('none');
    });

    it('drops a stale resolution after zapping to another channel', async () => {
        const first = deferred<{ id: number; title: string } | null>();
        const second = deferred<{ id: number; title: string } | null>();
        enrichMovie
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        service.load({ id: 'ch1', name: 'Dune' });
        service.load({ id: 'ch2', name: 'Alien' });

        // The FIRST channel's answer arrives after the switch — must not land
        first.resolve({ id: 1, title: 'Dune' });
        await flush();
        expect(service.state().status).toBe('loading');
        expect(service.state().channelId).toBe('ch2');

        second.resolve({ id: 2, title: 'Alien' });
        await flush();
        expect(service.state()).toEqual({
            channelId: 'ch2',
            status: 'matched',
            details: { id: 2, title: 'Alien' },
        });
    });

    it('does not re-request the channel the state already tracks', async () => {
        enrichMovie.mockResolvedValue({ id: 1, title: 'Dune' });

        service.load({ id: 'ch1', name: 'Dune' });
        await flush();
        service.load({ id: 'ch1', name: 'Dune' });

        expect(enrichMovie).toHaveBeenCalledTimes(1);
    });

    it('settles as "none" without a request while TMDB is disabled', () => {
        isEnabled.mockReturnValue(false);

        service.load({ id: 'ch1', name: 'Dune' });

        expect(service.state().status).toBe('none');
        expect(enrichMovie).not.toHaveBeenCalled();
    });

    it('reset returns to idle', async () => {
        enrichMovie.mockResolvedValue(null);
        service.load({ id: 'ch1', name: 'Dune' });
        await flush();

        service.reset();

        expect(service.state()).toEqual({
            channelId: null,
            status: 'idle',
            details: null,
        });
    });
});
