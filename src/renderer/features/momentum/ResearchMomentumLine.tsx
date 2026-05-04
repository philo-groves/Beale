import { memo, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { useDevRenderProbe } from '../../devInstrumentation';
import { contextMeterForDetail, visibleContextMeterLabel, visibleSessionTokenUsageLabel } from './contextMeter';
import type { ResearchMomentum, ResearchMomentumState } from './types';

const CONTEXT_COMPACTION_LICK_MS = 2200;
const MOMENTUM_SNAKE_BODY = '#0e0c0d';
const MOMENTUM_SNAKE_EDGE = 'rgba(55, 40, 50, 0.9)';
const MOMENTUM_SNAKE_EDGE_STRONG = 'rgba(55, 40, 50, 0.9)';
const MOMENTUM_SNAKE_HIGHLIGHT = 'rgba(255, 240, 255, 0.04)';
const MOMENTUM_SNAKE_TICK = 'rgba(55, 38, 50, 0.7)';
const MOMENTUM_SNAKE_EYE_SOCKET = '#060405';
const MOMENTUM_SNAKE_EYE_IRIS = '#5c3a10';
const MOMENTUM_SNAKE_EYE_PUPIL = '#030202';
const MOMENTUM_SNAKE_TONGUE = '#cc3350';
const MOMENTUM_GOAL_ICON = '#b4b2a9';
const MOMENTUM_GOAL_SHADOW_ACTIVE = 'rgba(68, 68, 65, 0.9)';
const MOMENTUM_GOAL_SHADOW = 'rgba(68, 68, 65, 0.68)';

export const ResearchMomentumLine = memo(function ResearchMomentumLine({ detail, momentum }: { detail: RunDetail | null; momentum: ResearchMomentum }): JSX.Element {
  useDevRenderProbe('footer.momentum', () => ({
    state: momentum.state,
    traceEvents: detail?.traceEvents.length ?? 0,
    compactions: detail?.contextCompactions.length ?? 0
  }));
  const label = researchMomentumLabel(momentum.state);
  const contextMeter = contextMeterForDetail(detail);
  const visibleContextLabel = visibleContextMeterLabel(contextMeter);
  const visibleSessionTokenLabel = visibleSessionTokenUsageLabel(contextMeter);
  const title = `Momentum: ${label}\nContext: ${contextMeter.label}\nSession tokens: ${visibleSessionTokenLabel}`;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextFractionRef = useRef(contextMeter.fraction);
  const targetContextFractionRef = useRef(contextMeter.fraction);
  const momentumValueRef = useRef(researchMomentumValue(momentum.state) / 100);
  const canvasMetricsRef = useRef<{ context: CanvasRenderingContext2D; width: number; height: number } | null>(null);
  const latestCompaction = detail?.contextCompactions.at(-1) ?? null;
  const latestCompactionKey = latestCompaction ? `${latestCompaction.id}:${latestCompaction.createdAt}` : '';
  const compactionKeyRef = useRef(latestCompactionKey);
  const compactionLickStartedAtRef = useRef<number | null>(null);
  const reduceMotion = usePrefersReducedMotion();
  const momentumValue = researchMomentumValue(momentum.state);

  useEffect(() => {
    if (compactionKeyRef.current === latestCompactionKey) return;
    const hadPreviousCompaction = Boolean(compactionKeyRef.current);
    compactionKeyRef.current = latestCompactionKey;
    if (!latestCompactionKey) return;

    const createdAt = latestCompaction ? Date.parse(latestCompaction.createdAt) : Number.NaN;
    const recentEnough = Number.isFinite(createdAt) && Date.now() - createdAt >= 0 && Date.now() - createdAt <= CONTEXT_COMPACTION_LICK_MS * 2;
    if (hadPreviousCompaction || recentEnough) {
      compactionLickStartedAtRef.current = performance.now();
    }
  }, [latestCompaction, latestCompactionKey]);

  useEffect(() => {
    targetContextFractionRef.current = contextMeter.fraction;
    momentumValueRef.current = momentumValue / 100;
    if (reduceMotion && canvasMetricsRef.current) {
      contextFractionRef.current = contextMeter.fraction;
      drawMomentumSnake(
        canvasMetricsRef.current.context,
        canvasMetricsRef.current.width,
        canvasMetricsRef.current.height,
        momentumValueRef.current,
        0,
        contextFractionRef.current,
        0
      );
    }
  }, [contextMeter.fraction, momentumValue, reduceMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    let frameId = 0;
    let lastTimestamp: number | null = null;
    let elapsed = 0;
    let width = 0;
    let height = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, Math.min(36, rect.height || 30));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvasMetricsRef.current = { context, width, height };
      if (reduceMotion) {
        contextFractionRef.current = targetContextFractionRef.current;
        drawMomentumSnake(context, width, height, momentumValueRef.current, elapsed, contextFractionRef.current, 0);
      }
    };

    const draw = (timestamp: number): void => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      const deltaSeconds = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
      lastTimestamp = timestamp;

      if (!reduceMotion) {
        elapsed += deltaSeconds;
      }
      const targetContextFraction = targetContextFractionRef.current;
      const nextContextFraction = reduceMotion
        ? targetContextFraction
        : contextFractionRef.current + (targetContextFraction - contextFractionRef.current) * Math.min(1, deltaSeconds * 2.4);
      contextFractionRef.current = nextContextFraction;
      const lickProgress = reduceMotion ? 0 : compactionLickProgress(timestamp, compactionLickStartedAtRef);
      drawMomentumSnake(context, width, height, momentumValueRef.current, elapsed, nextContextFraction, lickProgress);

      if (!reduceMotion) {
        frameId = window.requestAnimationFrame(draw);
      }
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    frameId = window.requestAnimationFrame(draw);

    return () => {
      canvasMetricsRef.current = null;
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, [reduceMotion]);

  return (
    <div className={`research-momentum-line momentum-${momentum.state}`} aria-label={title} title={title}>
      <canvas className="momentum-snake-canvas" ref={canvasRef} aria-hidden="true" />
      <span className="momentum-context-label">{visibleContextLabel}</span>
      <span className="momentum-session-token-label" aria-label={`Total tokens used this session: ${visibleSessionTokenLabel}`}>
        {visibleSessionTokenLabel}
      </span>
    </div>
  );
});

function compactionLickProgress(timestamp: number, startedAtRef: { current: number | null }): number {
  const startedAt = startedAtRef.current;
  if (startedAt === null) return 0;
  const progress = Math.max(0, Math.min(1, (timestamp - startedAt) / CONTEXT_COMPACTION_LICK_MS));
  if (progress >= 1) {
    startedAtRef.current = null;
    return 0;
  }
  return progress;
}

function compactionLickContextFraction(contextFraction: number, lickProgress: number): number {
  if (lickProgress <= 0) return contextFraction;
  if (lickProgress < 0.36) {
    const eased = easeOutCubic(lickProgress / 0.36);
    return contextFraction + (1 - contextFraction) * eased;
  }
  if (lickProgress < 0.56) return 1;

  const recoil = easeOutBack((lickProgress - 0.56) / 0.44);
  return 1 - (1 - contextFraction) * recoil;
}

function easeOutCubic(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - clamped, 3);
}

function easeOutBack(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2);
}

function drawMomentumSnake(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  momentum: number,
  elapsed: number,
  contextFraction: number,
  lickProgress: number
): void {
  if (width <= 0 || height <= 0) return;
  const pointCount = 200;
  const clampedMomentum = Math.max(0, Math.min(1, momentum));
  const lickContextFraction = compactionLickContextFraction(contextFraction, lickProgress);
  const clampedContext = Math.max(0, Math.min(1, lickContextFraction));
  const maxAmplitude = height / 2 - 5;
  const amplitude = clampedMomentum === 0 ? 0 : 1 + clampedMomentum * maxAmplitude;
  const speed = 0.8 + clampedMomentum * 5;
  const centerY = height / 2;
  const phase = elapsed * speed;
  const startX = 18;
  const strawberryX = Math.max(startX + 86, width - 18);
  const maxHeadX = Math.max(startX + 34, strawberryX - 25);
  const minimumFraction = width < 180 ? 0.24 : 0.12;
  const visibleContextFraction = Math.max(minimumFraction, clampedContext);
  const endX = startX + (maxHeadX - startX) * visibleContextFraction;
  const points: Array<[number, number]> = [];

  context.clearRect(0, 0, width, height);
  drawContextGoalStrawberry(context, strawberryX, centerY, clampedContext, lickProgress);

  for (let index = 0; index <= pointCount; index += 1) {
    const fraction = index / pointCount;
    const x = startX + (endX - startX) * fraction;
    const taper = 0.1 + 0.9 * fraction;
    const wave =
      Math.sin(fraction * Math.PI * 5 - phase) * amplitude * taper +
      Math.sin(fraction * Math.PI * 2.1 - phase * 0.65) * amplitude * 0.2 * taper;
    points.push([x, Math.max(3, Math.min(height - 3, centerY + wave))]);
  }

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  drawMomentumSnakePath(context, points);
  context.strokeStyle = MOMENTUM_SNAKE_EDGE;
  context.lineWidth = 10.5;
  context.stroke();

  drawMomentumSnakePath(context, points);
  context.strokeStyle = MOMENTUM_SNAKE_BODY;
  context.lineWidth = clampedMomentum > 0.85 ? 7.2 : 6.5;
  context.stroke();

  drawMomentumSnakePath(context, points);
  context.strokeStyle = MOMENTUM_SNAKE_HIGHLIGHT;
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();

  drawMomentumSnakeTicks(context, points);
  drawMomentumSnakeHead(context, points, pointCount, phase, clampedMomentum, clampedContext, lickProgress);
}

function drawMomentumSnakePath(context: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const midpointX = (points[index][0] + points[index + 1][0]) / 2;
    const midpointY = (points[index][1] + points[index + 1][1]) / 2;
    context.quadraticCurveTo(points[index][0], points[index][1], midpointX, midpointY);
  }
  const last = points[points.length - 1];
  context.lineTo(last[0], last[1]);
}

function drawMomentumSnakeTicks(context: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  const step = 10;
  for (let index = step; index < points.length - step; index += step) {
    const [x, y] = points[index];
    context.beginPath();
    context.moveTo(x, y - 2.5);
    context.lineTo(x, y + 2.5);
    context.strokeStyle = MOMENTUM_SNAKE_TICK;
    context.lineWidth = 0.8;
    context.stroke();
  }
}

function drawMomentumSnakeHead(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  pointCount: number,
  phase: number,
  momentum: number,
  contextFraction: number,
  lickProgress: number
): void {
  const [headX, headY] = points[pointCount];
  const previous = points[Math.max(0, pointCount - 4)];
  const angle = Math.atan2(headY - previous[1], headX - previous[0]);
  const forcedLick = lickProgress >= 0.28 && lickProgress <= 0.62;
  const tongueVisible = forcedLick || ((momentum > 0.18 || contextFraction > 0.94) && Math.sin(phase * 3.5) > 0.3);

  context.save();
  context.translate(headX, headY);
  context.rotate(angle);

  context.beginPath();
  context.ellipse(7, 0, 9, 6, 0, 0, Math.PI * 2);
  context.fillStyle = MOMENTUM_SNAKE_BODY;
  context.fill();
  context.beginPath();
  context.ellipse(7, 0, 9, 6, 0, 0, Math.PI * 2);
  context.strokeStyle = MOMENTUM_SNAKE_EDGE_STRONG;
  context.lineWidth = 1.2;
  context.stroke();

  context.beginPath();
  context.ellipse(4, -2, 4, 2.5, -0.3, 0, Math.PI * 2);
  context.fillStyle = MOMENTUM_SNAKE_HIGHLIGHT;
  context.fill();

  context.beginPath();
  context.arc(13, -2.5, 2.2, 0, Math.PI * 2);
  context.fillStyle = MOMENTUM_SNAKE_EYE_SOCKET;
  context.fill();
  context.beginPath();
  context.arc(13, -2.5, 1.5, 0, Math.PI * 2);
  context.fillStyle = MOMENTUM_SNAKE_EYE_IRIS;
  context.fill();
  context.beginPath();
  context.arc(13, -2.5, 0.8, 0, Math.PI * 2);
  context.fillStyle = MOMENTUM_SNAKE_EYE_PUPIL;
  context.fill();
  context.beginPath();
  context.arc(13.4, -2.9, 0.4, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.4)';
  context.fill();

  if (tongueVisible) {
    const tongueStemEndX = forcedLick ? 21 : 22;
    const tongueForkEndX = forcedLick ? 25 : 26;
    context.strokeStyle = MOMENTUM_SNAKE_TONGUE;
    context.lineWidth = 1;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(16, 0);
    context.lineTo(tongueStemEndX, 0);
    context.stroke();
    context.beginPath();
    context.moveTo(tongueStemEndX, 0);
    context.lineTo(tongueForkEndX, -3);
    context.stroke();
    context.beginPath();
    context.moveTo(tongueStemEndX, 0);
    context.lineTo(tongueForkEndX, 3);
    context.stroke();
  }

  context.restore();
}

function drawContextGoalStrawberry(context: CanvasRenderingContext2D, x: number, y: number, contextFraction: number, lickProgress: number): void {
  const active = contextFraction >= 0.94 || (lickProgress >= 0.28 && lickProgress <= 0.72);
  const iconColor = MOMENTUM_GOAL_ICON;
  const shadowColor = active ? MOMENTUM_GOAL_SHADOW_ACTIVE : MOMENTUM_GOAL_SHADOW;
  const pulse = lickProgress > 0 ? Math.sin(Math.min(1, lickProgress) * Math.PI) : 0;

  const drawBerryOutline = () => {
    context.beginPath();
    context.moveTo(0, -6.2);
    context.bezierCurveTo(5.7, -8.1, 10.2, -3.9, 9.1, 2.4);
    context.bezierCurveTo(8.2, 7.4, 3.4, 10.8, 0, 12.8);
    context.bezierCurveTo(-3.4, 10.8, -8.2, 7.4, -9.1, 2.4);
    context.bezierCurveTo(-10.2, -3.9, -5.7, -8.1, 0, -6.2);
    context.closePath();
  };

  const drawLeafCap = () => {
    context.beginPath();
    context.moveTo(-7.2, -7);
    context.quadraticCurveTo(-4.4, -6.6, -2.6, -4.5);
    context.quadraticCurveTo(-1.3, -7.2, 0, -8.8);
    context.quadraticCurveTo(1.3, -7.2, 2.6, -4.5);
    context.quadraticCurveTo(4.4, -6.6, 7.2, -7);
    context.quadraticCurveTo(5.2, -4.8, 2.9, -3.4);
    context.quadraticCurveTo(1.4, -3.8, 0, -3.4);
    context.quadraticCurveTo(-1.4, -3.8, -2.9, -3.4);
    context.quadraticCurveTo(-5.2, -4.8, -7.2, -7);
  };

  context.save();
  context.translate(x, y - 2);
  context.scale(1 + pulse * 0.07, 1 + pulse * 0.07);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  drawBerryOutline();
  context.fillStyle = active ? 'rgba(180, 178, 169, 0.14)' : 'rgba(180, 178, 169, 0.07)';
  context.fill();

  drawBerryOutline();
  context.strokeStyle = shadowColor;
  context.lineWidth = 4.2;
  context.stroke();

  drawBerryOutline();
  context.strokeStyle = iconColor;
  context.lineWidth = 1.8;
  context.stroke();

  drawLeafCap();
  context.strokeStyle = shadowColor;
  context.lineWidth = 3.8;
  context.stroke();

  drawLeafCap();
  context.strokeStyle = iconColor;
  context.lineWidth = 1.5;
  context.stroke();

  const seeds: Array<[number, number, number]> = [
    [-3.8, -1, -0.34],
    [3.7, -0.6, 0.34],
    [-4.2, 3.2, -0.18],
    [0.1, 4.8, 0],
    [4.1, 3.2, 0.18],
    [-1.7, 8.2, -0.12],
    [1.7, 8.2, 0.12]
  ];
  context.strokeStyle = iconColor;
  context.lineWidth = 1.2;
  for (const [seedX, seedY, rotation] of seeds) {
    context.save();
    context.translate(seedX, seedY);
    context.rotate(rotation);
    context.beginPath();
    context.moveTo(0, -0.9);
    context.quadraticCurveTo(1.1, 0.1, 0, 1.2);
    context.quadraticCurveTo(-1.1, 0.1, 0, -0.9);
    context.stroke();
    context.restore();
  }

  context.restore();
}

function usePrefersReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduceMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduceMotion;
}

function researchMomentumLabel(state: ResearchMomentumState): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'exploring':
      return 'Exploring';
    case 'building':
      return 'Building';
    case 'verifying':
      return 'Verifying';
    case 'hot':
      return 'Hot Lead';
    case 'stuck':
      return 'Stuck';
    case 'waiting':
      return 'Waiting';
  }
}

function researchMomentumValue(state: ResearchMomentumState): number {
  switch (state) {
    case 'idle':
      return 0;
    case 'waiting':
      return 20;
    case 'exploring':
      return 40;
    case 'building':
      return 50;
    case 'verifying':
      return 80;
    case 'hot':
      return 100;
    case 'stuck':
      return 30;
  }
}
