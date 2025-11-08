import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RecentPlaylistsComponent } from 'components';
import { HeaderComponent } from '../shared/components/header/header.component';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    imports: [HeaderComponent, RecentPlaylistsComponent, TranslatePipe],
})
export class HomeComponent {}
