import { DIALOG_WIDTHS, dialogSize } from './dialog-size';

describe('dialogSize', () => {
    it.each(['sm', 'md', 'lg'] as const)(
        'owns the width and the viewport limits of the %s preset',
        (size) => {
            expect(dialogSize(size)).toEqual({
                width: DIALOG_WIDTHS[size],
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: 'calc(100vh - 32px)',
            });
        }
    );

    it('lets the call site override a limit by spreading the preset first', () => {
        expect({ ...dialogSize('md'), maxHeight: '90vh' }).toMatchObject({
            width: '560px',
            maxHeight: '90vh',
        });
    });
});
