import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { FavoriteFoldersView } from './favorite-folders-view';

@Component({
    selector: 'app-favorite-folders-toolbar',
    imports: [
        MatButton,
        MatCheckbox,
        MatIcon,
        MatIconButton,
        MatMenu,
        MatMenuItem,
        MatMenuTrigger,
        MatTooltip,
        NgTemplateOutlet,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './favorite-folders-toolbar.component.html',
    styleUrl: './favorite-folders-toolbar.component.scss',
})
export class FavoriteFoldersToolbarComponent {
    readonly view = input.required<FavoriteFoldersView>();
}
