import type { LiveState } from '../../shared/types';

interface Props {
  liveState: LiveState;
}

export default function LiveBanner({ liveState }: Props) {
  // `reference` is computed once in liveStateRepository — never render raw row ids here.
  // The operator has to be able to read this at a glance and know what the stream shows.
  const label =
    liveState.reference == null
      ? 'Nothing live'
      : liveState.hidden
        ? `OUTPUT BLANK — ${liveState.reference} is selected`
        : `LIVE: ${liveState.reference}`;

  return (
    <div role="status" data-hidden={liveState.hidden ? 'true' : 'false'}>
      {label}
    </div>
  );
}
