import { memo } from 'react';
import type { JSX } from 'react';
import { useDevRenderProbe } from '../devInstrumentation';

const APP_BACKGROUND_PULSE_COUNT = 18;
const APP_BACKGROUND_PULSES = Array.from({ length: APP_BACKGROUND_PULSE_COUNT }, (_, index) => index);

export const AppBackgroundPulses = memo(function AppBackgroundPulses(): JSX.Element {
  useDevRenderProbe('background.pulses');

  return (
    <div className="app-background-pulses" aria-hidden="true">
      {APP_BACKGROUND_PULSES.map((pulse) => (
        <span className="app-background-pulse" key={pulse} />
      ))}
    </div>
  );
});
