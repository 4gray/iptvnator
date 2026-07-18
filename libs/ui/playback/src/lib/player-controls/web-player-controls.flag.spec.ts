import { TestBed } from '@angular/core/testing';
import {
    WEB_PLAYER_SHARED_CONTROLS,
    WEB_PLAYER_SHARED_CONTROLS_ENABLED,
} from './web-player-controls.flag';

describe('WEB_PLAYER_SHARED_CONTROLS flag', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('is rolled out OFF by default', () => {
        expect(WEB_PLAYER_SHARED_CONTROLS_ENABLED).toBe(false);
    });

    it('resolves the constant through the root injection token', () => {
        TestBed.configureTestingModule({});
        expect(TestBed.inject(WEB_PLAYER_SHARED_CONTROLS)).toBe(
            WEB_PLAYER_SHARED_CONTROLS_ENABLED
        );
    });

    it('can be overridden via a TestBed provider', () => {
        TestBed.configureTestingModule({
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: true },
            ],
        });
        expect(TestBed.inject(WEB_PLAYER_SHARED_CONTROLS)).toBe(true);
    });
});
