export function HomeSourceStatus({
    actions,
}: {
    actions: { pending: boolean; cancel: () => void };
}) {
    return actions.pending ? (
        <div class="home-source-pending" role="status">
            Opening the title…{' '}
            <button onClick={actions.cancel}>Cancel opening title</button>
        </div>
    ) : null;
}
