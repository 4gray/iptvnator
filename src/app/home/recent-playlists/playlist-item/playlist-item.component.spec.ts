/* tslint:disable:no-unused-variable */
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockModule, MockPipe, MockProviders } from 'ng-mocks';
import { PlaylistItemComponent } from './playlist-item.component';

describe('PlaylistItemComponent', () => {
    let component: PlaylistItemComponent;
    let fixture: ComponentFixture<PlaylistItemComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [PlaylistItemComponent, MockPipe(TranslatePipe)],
                providers: [MockProviders(TranslateService)],
                imports: [
                    MockModule(MatIconModule),
                    MockModule(MatListModule),
                    MockModule(MatTooltipModule),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(PlaylistItemComponent);
        component = fixture.componentInstance;
        component.item = { title: 'Playlist', id: '1' } as any;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
