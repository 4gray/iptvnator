import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { TrailerDialogState } from './trailer-dialog-state';
import { TrailerDialogService } from './trailer-dialog.service';

describe('TrailerDialogService', () => {
    it('reports the modal as open until it closed', () => {
        const closed = new Subject<void>();
        const open = jest.fn().mockReturnValue({ afterClosed: () => closed });
        TestBed.configureTestingModule({
            providers: [{ provide: MatDialog, useValue: { open } }],
        });
        const state = TestBed.inject(TrailerDialogState);

        TestBed.inject(TrailerDialogService).open({
            embedUrl: 'https://www.youtube-nocookie.com/embed/abc',
            title: 'Black Harbor',
        });
        expect(open).toHaveBeenCalledTimes(1);
        expect(state.dialogOpen()).toBe(true);

        closed.next();
        expect(state.dialogOpen()).toBe(false);
    });
});
