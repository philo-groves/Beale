import { memo, useCallback, useState } from 'react';
import type { AnimationEvent as ReactAnimationEvent, CSSProperties, JSX } from 'react';
import { useDevRenderProbe } from '../devInstrumentation';

interface BackgroundPulse {
  id: number;
  cycle: number;
  style: CSSProperties;
}

const APP_BACKGROUND_PULSE_COUNT = 18;

export const AppBackgroundPulses = memo(function AppBackgroundPulses(): JSX.Element {
  useDevRenderProbe('background.pulses');
  const [pulses, setPulses] = useState<BackgroundPulse[]>(() =>
    Array.from({ length: APP_BACKGROUND_PULSE_COUNT }, (_, index) => ({
      id: index,
      cycle: 0,
      style: randomBackgroundPulseStyle(index, true)
    }))
  );

  const rerollPulse = useCallback((id: number, event: ReactAnimationEvent<HTMLSpanElement>): void => {
    if (event.animationName !== 'app-background-pulse') return;
    setPulses((current) =>
      current.map((pulse) =>
        pulse.id === id
          ? {
              ...pulse,
              cycle: pulse.cycle + 1,
              style: randomBackgroundPulseStyle(id, false)
            }
          : pulse
      )
    );
  }, []);

  return (
    <div className="app-background-pulses" aria-hidden="true">
      {pulses.map((pulse) => (
        <span className="app-background-pulse" key={`${pulse.id}-${pulse.cycle}`} style={pulse.style} onAnimationEnd={(event) => rerollPulse(pulse.id, event)} />
      ))}
    </div>
  );
});

function randomBackgroundPulseStyle(index: number, initial: boolean): CSSProperties {
  const size = randomInteger(44, 118);
  const delay = initial ? randomFloat(0, 2.8) : randomFloat(0.12, 2.4);
  const durationScale = randomFloat(0.88, 1.18);
  return {
    '--pulse-x': `${randomFloat(3, 97).toFixed(1)}%`,
    '--pulse-y': `${randomFloat(4, 96).toFixed(1)}%`,
    '--pulse-size': `${size}px`,
    '--pulse-radius': `${randomInteger(8, 19)}px`,
    '--pulse-delay': `${delay.toFixed(2)}s`,
    '--pulse-duration': `calc(var(--app-pulse-duration) * ${durationScale.toFixed(2)})`,
    '--pulse-rotation': `${randomInteger(-12, 12)}deg`,
    '--pulse-seed': String(index)
  } as CSSProperties;
}

function randomInteger(min: number, max: number): number {
  return Math.floor(randomFloat(min, max + 1));
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
