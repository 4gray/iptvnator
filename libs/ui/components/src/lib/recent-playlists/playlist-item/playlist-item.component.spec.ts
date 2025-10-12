import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule } from 'ng-mocks';
import { DataService } from '../../../../../../services/src/lib/data.service';
import { PlaylistItemComponent } from './playlist-item.component';

describe('PlaylistItemComponent', () => {
    let component: PlaylistItemComponent;
    let fixture: ComponentFixture<PlaylistItemComponent>;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [
                PlaylistItemComponent,
                MockModule(MatIconModule),
                MockModule(MatListModule),
                MockModule(MatTooltipModule),
                TranslateModule.forRoot(),
            ],
            providers: [DataService],
        }).compileComponents();
    }));

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
