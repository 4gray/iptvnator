import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { ChannelListHiddenStateComponent } from './channel-list-hidden-state.component';

describe('ChannelListHiddenStateComponent', () => {
    let fixture: ComponentFixture<ChannelListHiddenStateComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ChannelListHiddenStateComponent],
        })
            .overrideComponent(ChannelListHiddenStateComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [MockPipe(TranslatePipe, (key: string) => key)],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(ChannelListHiddenStateComponent);
        fixture.detectChanges();
    });

    it('explains that the list is hidden instead of asking to pick a channel', () => {
        const host: HTMLElement = fixture.nativeElement;

        expect(host.querySelector('.empty-state-title')?.textContent).toContain(
            'LAYOUT.CHANNELS_LIST_HIDDEN'
        );
        expect(host.querySelector('.empty-state-hint')?.textContent).toContain(
            'LAYOUT.CHANNELS_LIST_HIDDEN_HINT'
        );
        expect(host.textContent).not.toContain('SELECT_CHANNEL_PLAYBACK');
    });

    it('offers a full-size restore action that emits once per click', () => {
        const restore = jest.fn();
        fixture.componentInstance.restore.subscribe(restore);
        const button: HTMLButtonElement | null =
            fixture.nativeElement.querySelector('button.empty-state-action');

        expect(button?.textContent).toContain('LAYOUT.SHOW_CHANNELS_LIST');

        button?.click();

        expect(restore).toHaveBeenCalledTimes(1);
    });
});
