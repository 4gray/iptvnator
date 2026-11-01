import { provideHttpClient } from '@angular/common/http';
import {
    HttpTestingController,
    provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
    fakeAsync,
    flushMicrotasks,
    TestBed,
    tick,
} from '@angular/core/testing';
import { TimeoutError } from 'rxjs';
import {
    RemoteControlService,
    RemoteControlStatus,
} from './remote-control.service';

const status: RemoteControlStatus = {
    portal: 'm3u',
    isLiveView: true,
    channelName: 'Recovered channel',
};

describe('RemoteControlService status requests', () => {
    let service: RemoteControlService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()],
        });
        service = TestBed.inject(RemoteControlService);
        http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('returns status from the remote API', async () => {
        const result = service.getStatus();
        http.expectOne('/api/remote-control/status').flush(status);
        await expect(result).resolves.toEqual(status);
    });

    it('cancels a stalled request after ten seconds and allows recovery', fakeAsync(() => {
        let failure: unknown;
        void service.getStatus().catch((error) => (failure = error));
        const stalled = http.expectOne('/api/remote-control/status');
        tick(9999);
        expect(stalled.cancelled).toBe(false);
        tick(1);
        expect(failure).toBeInstanceOf(TimeoutError);
        expect(stalled.cancelled).toBe(true);

        let recovered: RemoteControlStatus | undefined;
        void service.getStatus().then((value) => (recovered = value));
        http.expectOne('/api/remote-control/status').flush(status);
        flushMicrotasks();
        expect(recovered).toEqual(status);
    }));
});
