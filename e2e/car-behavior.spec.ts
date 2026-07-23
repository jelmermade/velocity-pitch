import { expect, test, type Page } from '@playwright/test';
import type { E2ECarStage } from '../src/app/E2ETestApi';
import type { CarState } from '../src/gameplay/car/CarState';

const VISUAL_PLAYBACK = process.env.E2E_VISUAL === '1';
const SAMPLE_INTERVAL_MS = VISUAL_PLAYBACK ? 50 : 0;
const SIMULATION_TICKS_PER_SAMPLE = VISUAL_PLAYBACK ? 3 : 90;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 } as const;

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1&vehicleDebug=1');
  await page.getByRole('button', { name: 'TRAINING' }).click();
  const canvas = page.locator('[data-render-layer] canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__velocityPitchE2E))).toBe(true);
  await page.evaluate(() => window.__velocityPitchE2E?.finishCountdown());
  await expect.poll(() => page.evaluate(() => window.__velocityPitchE2E?.matchPhase()), {
    timeout: 10_000,
  }).toBe('playing');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Rendered arena canvas has no bounds');
  await canvas.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await installScenarioBanner(page);
});

test('ground handling: acceleration, braking, steering, and powersliding', async ({ page }) => {
  await test.step('accelerates, brakes, and engages reverse', async () => {
    await stageCar(page, 'GROUND // ACCELERATION', flatStage());
    const acceleration = await holdKeys(page, ['w'], 1_800, 'GROUND // ACCELERATION');
    const accelerated = last(acceleration);
    expect(horizontalSpeed(accelerated)).toBeGreaterThan(12);
    expect(accelerated.transform.position.z).toBeLessThan(20);
    expect(groundedRatio(acceleration)).toBeGreaterThan(0.9);

    const braking = await holdKeys(page, ['s'], 1_800, 'GROUND // BRAKING');
    expect(await page.evaluate(() => window.__velocityPitchE2E?.latestInput().throttle)).toBe(-1);
    expect(forwardSpeed(last(braking))).toBeLessThan(0);

    const reversing = await holdKeys(page, ['s'], 1_400, 'GROUND // REVERSE');
    expect(forwardSpeed(last(reversing))).toBeLessThan(-2);
  });

  for (const turn of [
    { name: 'LEFT', key: 'a', sign: -1 },
    { name: 'RIGHT', key: 'd', sign: 1 },
  ] as const) {
    await test.step(`steers ${turn.name.toLowerCase()} while retaining traction`, async () => {
      await stageCar(page, `STEERING // ${turn.name}`, flatStage({ x: 0, y: 0, z: -22 }));
      const samples = await holdKeys(page, ['w', turn.key], 1_100, `STEERING // ${turn.name}`);
      const finalState = last(samples);
      const metrics = cornerMetrics(finalState);
      expect((finalState.transform.position.x + 20) * turn.sign).toBeGreaterThan(1);
      expect(metrics.slipRatio).toBeLessThan(0.35);
      expect(groundedRatio(samples)).toBeGreaterThan(0.9);
    });
  }

  for (const turn of [
    { name: 'LEFT', key: 'a', sign: -1 },
    { name: 'RIGHT', key: 'd', sign: 1 },
  ] as const) {
    await test.step(`powerslides ${turn.name.toLowerCase()} more tightly than a normal turn`, async () => {
      await stageCar(page, `NORMAL TURN // ${turn.name}`, flatStage({ x: 0, y: 0, z: -25 }));
      const normal = cornerMetrics(last(await holdKeys(
        page,
        ['w', turn.key],
        800,
        `NORMAL TURN // ${turn.name}`,
      )));

      await stageCar(page, `POWERSLIDE // ${turn.name}`, flatStage({ x: 0, y: 0, z: -25 }));
      const sliding = cornerMetrics(last(await holdKeys(
        page,
        ['w', turn.key, 'Shift'],
        800,
        `POWERSLIDE // ${turn.name}`,
      )));

      expect(Math.abs(sliding.heading)).toBeGreaterThan(Math.abs(normal.heading) * 1.05);
      expect(sliding.slipRatio).toBeGreaterThan(normal.slipRatio + 0.05);
      expect(sliding.turnRadius).toBeLessThan(normal.turnRadius);
    });
  }
});

test('aerial handling: jumping, pitching, boosting, air roll, and landing', async ({ page }) => {
  await test.step('jumps, pitches upward, and boost-flies', async () => {
    await stageCar(page, 'AERIAL // TAKEOFF', flatStage());
    await page.mouse.down({ button: 'right' });
    const takeoff = await sampleFor(page, 180, 'AERIAL // JUMP');
    await page.mouse.up({ button: 'right' });

    await stageCar(page, 'AERIAL // PITCH CONTROL', airborneStage());
    const pitch = await holdKeys(page, ['s'], 1_000, 'AERIAL // PITCH UP');
    expect(await page.evaluate(() => window.__velocityPitchE2E?.latestInput().throttle)).toBe(-1);
    const pitchedState = pitch.reduce((best, state) => (
      forward(state).y > forward(best).y ? state : best
    ));
    await stageCar(page, 'AERIAL // BOOST FLIGHT', {
      transform: {
        position: { x: 0, y: 20, z: 8 },
        rotation: pitchedState.transform.rotation,
      },
    });
    await page.mouse.down({ button: 'left' });
    const flight = await sampleFor(page, 1_100, 'AERIAL // BOOST FLIGHT');
    await page.mouse.up({ button: 'left' });

    expect(Math.max(...takeoff.map(({ transform }) => transform.position.y))).toBeGreaterThan(0.8);
    const pitchHeights = pitch.map((state) => forward(state).y);
    const maximumPitch = Math.max(...pitchHeights);
    expect(maximumPitch).toBeGreaterThan(0.85);
    expect(flight.some(({ boosting }) => boosting)).toBe(true);
    expect(last(flight).transform.position.y).toBeGreaterThan(first(flight).transform.position.y + 3);
    expect(flight.filter(({ grounded }) => !grounded).length).toBeGreaterThan(flight.length * 0.9);
  });

  for (const roll of [
    { name: 'LEFT', key: 'q', sign: -1 },
    { name: 'RIGHT', key: 'e', sign: 1 },
  ] as const) {
    await test.step(`air-rolls ${roll.name.toLowerCase()} and damps after release`, async () => {
      await stageCar(page, `AIR ROLL // ${roll.name}`, airborneStage());
      const controlled = await holdKeys(page, [roll.key], 550, `AIR ROLL // ${roll.name}`);
      const signedRoll = controlled.map((state) => axisSpeed(state.angularVelocity, forward(state)));
      const peakRoll = Math.max(...signedRoll.map(Math.abs));
      const released = await sampleFor(page, 650, `AIR ROLL // ${roll.name} RELEASE`);

      expect(peakRoll).toBeGreaterThan(1.5);
      expect(signedRoll.at(-1) ?? 0).toBeCloseTo(roll.sign * peakRoll, 0);
      expect(angularSpeed(last(released))).toBeLessThan(peakRoll * 0.6);
      expect(released.every(({ grounded }) => !grounded)).toBe(true);
    });
  }

  await test.step('settles upright after an off-angle landing', async () => {
    const angle = Math.PI / 6;
    await stageCar(page, 'LANDING // OFF-ANGLE RECOVERY', {
      transform: {
        position: { x: 0, y: 6, z: 8 },
        rotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
      },
      linearVelocity: { x: 0, y: -8, z: 0 },
    });
    const landing = await sampleFor(page, 4_000, 'LANDING // OFF-ANGLE RECOVERY');
    const settled = last(landing);
    expect(landing.some(({ grounded }) => grounded)).toBe(true);
    expect(up(settled).y).toBeGreaterThan(0.9);
    expect(angularSpeed(settled)).toBeLessThan(0.5);
  });
});

test('wall handling: transition grip, climbing, steering, and jump detachment', async ({ page }) => {
  test.setTimeout(420_000);
  const arena = await page.evaluate(() => window.__velocityPitchE2E?.arena);
  if (!arena) throw new Error('Velocity Pitch arena tuning is unavailable');
  const wallCases = [8, 20, 32, 38].flatMap((speed) => (
    [-35, 0, 35].map((angleDegrees) => ({ speed, angleDegrees, boost: speed === 38 }))
  ));

  for (const wallCase of wallCases) {
    await test.step(`rides the wall at ${wallCase.speed} units/s from ${wallCase.angleDegrees} degrees`, async () => {
      const angle = wallCase.angleDegrees * Math.PI / 180;
      const direction = { x: Math.cos(angle), z: Math.sin(angle) };
      // Leave enough flat approach for the 300 ms staging playback even at boost speed.
      const approachDistance = arena.floorWallCurveRadius + 15;
      const label = `WALL RIDE // ${wallCase.speed} U/S // ${wallCase.angleDegrees}°`;
      await stageCar(page, label, {
        transform: {
          position: {
            x: arena.halfWidth - approachDistance,
            y: 0.65,
            z: -Math.tan(angle) * approachDistance,
          },
          rotation: yawRotationFor(direction.x, direction.z),
        },
        linearVelocity: { x: direction.x * wallCase.speed, y: 0, z: direction.z * wallCase.speed },
      });
      const samples = wallCase.boost
        ? await holdKeysAndBoost(page, ['w'], 3_000, label)
        : await holdKeys(page, ['w'], 3_000, label);
      const wallSamples = samples.filter((state) => (
        (state.surfaceDebug?.surfaceNormal?.x ?? 0) < -0.8
        && state.transform.position.x > arena.halfWidth - 2
      ));
      const transition = wallTransitionMetrics(samples);
      const transitionContext = JSON.stringify({ wallCase, ...transition });

      expect(wallSamples.length).toBeGreaterThan(0);
      expect(groundedRatio(wallSamples)).toBeGreaterThan(0.8);
      expect(Math.min(...wallSamples.map((state) => up(state).x))).toBeLessThan(-0.8);
      expect(Math.max(...wallSamples.map(({ transform }) => transform.position.y))).toBeGreaterThan(
        arena.floorWallCurveRadius + 1,
      );
      expect(transition.rampSamples, transitionContext).toBeGreaterThan(0);
      expect(transition.wallSamples, transitionContext).toBeGreaterThan(0);
      expect(transition.minimumRampSurfaceSpeed, transitionContext).toBeGreaterThan(
        transition.flatEntrySurfaceSpeed * 0.99,
      );
      expect(transition.wallEntrySurfaceSpeed, transitionContext).toBeGreaterThan(
        transition.flatEntrySurfaceSpeed * 0.99,
      );
      expect(transition.minimumRampClimbSpeed, transitionContext).toBeGreaterThan(
        transition.flatEntryClimbSpeed * 0.98,
      );
      expect(transition.wallEntryClimbSpeed, transitionContext).toBeGreaterThan(
        transition.flatEntryClimbSpeed * 0.98,
      );
      expect(transition.minimumRampMovementRatio, transitionContext).toBeGreaterThan(0.45);
      expect(transition.rampTravelRatio, transitionContext).toBeGreaterThan(0.9);
      expect(transition.wallEntrySurfaceSpeed, transitionContext).toBeLessThan(
        transition.averageRampMovementSpeed * 1.25,
      );
    });
  }

  for (const turn of [
    { name: 'DOWN', key: 'a', sign: -1 },
    { name: 'UP', key: 'd', sign: 1 },
  ] as const) {
    await test.step(`steers ${turn.name.toLowerCase()} while driving horizontally on the wall`, async () => {
      const startHeight = 20;
      await stageCar(page, `WALL STEERING // ${turn.name}`, {
        transform: {
          position: { x: arena.halfWidth - 0.54, y: startHeight, z: 0 },
          rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
        },
        linearVelocity: { x: 0, y: 0, z: -20 },
      });
      const samples = await holdKeys(page, ['w', turn.key], 900, `WALL STEERING // ${turn.name}`);
      const directedHeightChange = Math.max(...samples.map(({ transform }) => (
        (transform.position.y - startHeight) * turn.sign
      )));
      expect(directedHeightChange).toBeGreaterThan(1);
      expect(groundedRatio(samples)).toBeGreaterThan(0.8);
      expect(Math.min(...samples.map((state) => up(state).x))).toBeLessThan(-0.8);
    });
  }

  await test.step('jumps away from a vertical wall', async () => {
    const startX = arena.halfWidth - 0.54;
    await stageCar(page, 'WALL // JUMP DETACH', {
      transform: {
        position: { x: startX, y: 15, z: 0 },
        rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      },
    });
    await sampleFor(page, 250, 'WALL // GRIP BEFORE JUMP');
    await page.mouse.down({ button: 'right' });
    const detachment = await sampleFor(page, 180, 'WALL // JUMP DETACH');
    await page.mouse.up({ button: 'right' });
    detachment.push(...await sampleFor(page, 700, 'WALL // AIRBORNE'));

    expect(detachment.some(({ grounded }) => !grounded)).toBe(true);
    expect(Math.min(...detachment.map(({ linearVelocity }) => linearVelocity.x))).toBeLessThan(-4);
    expect(startX - last(detachment).transform.position.x).toBeGreaterThan(0.75);
  });
});

test('ceiling handling: a climbing wall ride detaches and falls', async ({ page }) => {
  const arena = await page.evaluate(() => window.__velocityPitchE2E?.arena);
  if (!arena) throw new Error('Velocity Pitch arena tuning is unavailable');
  const upperCurveStart = arena.height - arena.floorWallCurveRadius;
  await stageCar(page, 'WALL // CEILING DETACH', {
    transform: {
      position: {
        x: arena.halfWidth - 0.54,
        y: upperCurveStart - 10,
        z: 0,
      },
      rotation: { x: 0.5, y: -0.5, z: 0.5, w: 0.5 },
    },
    linearVelocity: { x: 0, y: 20, z: 0 },
  });
  const samples = await holdKeys(page, ['w'], 2_000, 'WALL // CEILING DETACH');
  const peakIndex = samples.reduce((bestIndex, state, index) => (
    state.transform.position.y > samples[bestIndex].transform.position.y ? index : bestIndex
  ), 0);
  const peakHeight = samples[peakIndex].transform.position.y;
  const afterPeak = samples.slice(peakIndex);
  const maximumDrop = peakHeight - Math.min(...afterPeak.map(({ transform }) => transform.position.y));

  expect(peakHeight).toBeGreaterThan(upperCurveStart);
  expect(samples.some((state) => (
    state.transform.position.y > upperCurveStart && !state.grounded
  ))).toBe(true);
  expect(Math.min(...afterPeak.map(({ linearVelocity }) => linearVelocity.y))).toBeLessThan(-2);
  expect(maximumDrop).toBeGreaterThan(3);
});

const flatStage = (linearVelocity = { x: 0, y: 0, z: 0 }): E2ECarStage => ({
  transform: { position: { x: -20, y: 0.62, z: 23 }, rotation: IDENTITY },
  linearVelocity,
  settleTicks: 120,
});

const airborneStage = (): E2ECarStage => ({
  transform: { position: { x: 0, y: 25, z: 8 }, rotation: IDENTITY },
});

const stageCar = async (page: Page, label: string, stage: E2ECarStage): Promise<void> => {
  await showScenario(page, label);
  await page.evaluate((nextStage) => {
    const api = window.__velocityPitchE2E;
    if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
    api.stageLocalCar(nextStage);
  }, stage);
  await sampleFor(page, 300, `${label} // STAGED`);
};

const holdKeys = async (
  page: Page,
  keys: readonly string[],
  milliseconds: number,
  label: string,
): Promise<CarState[]> => {
  for (const key of keys) await page.keyboard.down(key);
  try {
    return await sampleFor(page, milliseconds, label);
  } finally {
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  }
};

const holdKeysAndBoost = async (
  page: Page,
  keys: readonly string[],
  milliseconds: number,
  label: string,
): Promise<CarState[]> => {
  for (const key of keys) await page.keyboard.down(key);
  await page.mouse.down({ button: 'left' });
  try {
    return await sampleFor(page, milliseconds, label);
  } finally {
    await page.mouse.up({ button: 'left' });
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
  }
};

const sampleFor = async (page: Page, milliseconds: number, label: string): Promise<CarState[]> => {
  const samples: CarState[] = [];
  let previousState = await page.evaluate(() => {
    const api = window.__velocityPitchE2E;
    if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
    return api.carState();
  });
  let remainingTicks = Math.max(1, Math.ceil(milliseconds / 1_000 * 60));
  while (remainingTicks > 0) {
    const ticks = Math.min(SIMULATION_TICKS_PER_SAMPLE, remainingTicks);
    const tickStates = await page.evaluate((tickCount) => {
      const api = window.__velocityPitchE2E;
      if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
      return api.advanceInputTicks(tickCount);
    }, ticks);
    samples.push(...tickStates);
    const state = last(tickStates);
    await updateScenarioBanner(page, label, state, previousState, ticks / 60);
    previousState = state;
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
    remainingTicks -= ticks;
  }
  return samples;
};

const installScenarioBanner = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const banner = document.createElement('aside');
    banner.dataset.e2eScenario = '';
    Object.assign(banner.style, {
      position: 'fixed',
      left: '50%',
      bottom: '6rem',
      zIndex: '100',
      minWidth: '30rem',
      padding: '0.75rem 1rem',
      transform: 'translateX(-50%)',
      border: '2px solid #b8ff66',
      color: '#eaffff',
      background: 'rgba(3, 16, 22, 0.9)',
      font: '700 14px monospace',
      letterSpacing: '0.08em',
      textAlign: 'center',
      whiteSpace: 'pre-line',
      pointerEvents: 'none',
    });
    document.body.append(banner);
  });
};

const showScenario = (page: Page, label: string): Promise<void> => page.evaluate((text) => {
  const banner = document.querySelector<HTMLElement>('[data-e2e-scenario]');
  if (banner) banner.textContent = `E2E // ${text}`;
}, label);

const updateScenarioBanner = (
  page: Page,
  label: string,
  state: CarState,
  previousState: CarState,
  elapsedSeconds: number,
): Promise<void> => page.evaluate(
  ({ scenario, car, previous, elapsed }) => {
    const banner = document.querySelector<HTMLElement>('[data-e2e-scenario]');
    if (!banner) return;
    const { x, y, z } = car.transform.position;
    const tangentVelocity = car.surfaceDebug?.tangentVelocity ?? car.linearVelocity;
    const surfaceSpeed = Math.hypot(tangentVelocity.x, tangentVelocity.y, tangentVelocity.z);
    const movementSpeed = Math.hypot(
      x - previous.transform.position.x,
      y - previous.transform.position.y,
      z - previous.transform.position.z,
    ) / elapsed;
    const normal = car.surfaceDebug?.surfaceNormal;
    const climbSpeed = normal
      ? tangentVelocity.x * normal.y - tangentVelocity.y * normal.x
      : car.linearVelocity.y;
    const rampDegrees = normal
      ? Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI
      : 0;
    banner.textContent = [
      `E2E // ${scenario} // ${car.grounded ? 'GRIP' : 'AIR'}`,
      `SURFACE ${surfaceSpeed.toFixed(1)} U/S // MOVE ${movementSpeed.toFixed(1)} U/S // CLIMB ${climbSpeed.toFixed(1)} U/S // Y RATE ${car.linearVelocity.y.toFixed(1)} U/S // RAMP ${rampDegrees.toFixed(0)}°`,
      `X ${x.toFixed(1)} // Y ${y.toFixed(1)} // Z ${z.toFixed(1)}`,
    ].join('\n');
  },
  { scenario: label, car: state, previous: previousState, elapsed: elapsedSeconds },
);

const last = <T>(values: readonly T[]): T => {
  const value = values.at(-1);
  if (value === undefined) throw new Error('Expected at least one telemetry sample');
  return value;
};

const first = <T>(values: readonly T[]): T => {
  const value = values[0];
  if (value === undefined) throw new Error('Expected at least one telemetry sample');
  return value;
};

const horizontalSpeed = ({ linearVelocity }: CarState): number => (
  Math.hypot(linearVelocity.x, linearVelocity.z)
);

const angularSpeed = ({ angularVelocity }: CarState): number => (
  Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z)
);

const groundedRatio = (states: readonly CarState[]): number => (
  states.filter(({ grounded }) => grounded).length / Math.max(1, states.length)
);

const wallTransitionMetrics = (states: readonly CarState[]) => {
  const flat = states.filter(({ surfaceDebug }) => (
    (surfaceDebug?.surfaceNormal?.y ?? -1) >= 0.98
  ));
  const ramp = states.filter(({ surfaceDebug }) => {
    const normalY = surfaceDebug?.surfaceNormal?.y ?? -1;
    return normalY > 0.08 && normalY < 0.92;
  });
  const wall = states.filter(({ surfaceDebug }) => (
    Math.abs(surfaceDebug?.surfaceNormal?.y ?? 1) <= 0.02
  ));
  const flatEntry = last(flat);
  const wallEntry = first(wall);
  const rampMovement = states.slice(1).flatMap((state, index) => {
    const normalY = state.surfaceDebug?.surfaceNormal?.y ?? -1;
    if (normalY <= 0.08 || normalY >= 0.92) return [];
    const previous = states[index];
    const movementSpeed = Math.hypot(
      state.transform.position.x - previous.transform.position.x,
      state.transform.position.y - previous.transform.position.y,
      state.transform.position.z - previous.transform.position.z,
    ) * 60;
    return [{ movementSpeed, expectedSpeed: surfaceTangentSpeed(state) }];
  });
  const actualRampDistance = rampMovement.reduce((sum, sample) => sum + sample.movementSpeed / 60, 0);
  const expectedRampDistance = rampMovement.reduce((sum, sample) => sum + sample.expectedSpeed / 60, 0);
  return {
    rampSamples: ramp.length,
    wallSamples: wall.length,
    flatEntrySurfaceSpeed: surfaceTangentSpeed(flatEntry),
    minimumRampSurfaceSpeed: Math.min(...ramp.map(surfaceTangentSpeed)),
    wallEntrySurfaceSpeed: surfaceTangentSpeed(wallEntry),
    flatEntryClimbSpeed: surfaceClimbSpeed(flatEntry),
    minimumRampClimbSpeed: Math.min(...ramp.map(surfaceClimbSpeed)),
    wallEntryClimbSpeed: surfaceClimbSpeed(wallEntry),
    minimumRampMovementRatio: Math.min(...rampMovement.map(
      ({ movementSpeed, expectedSpeed }) => movementSpeed / Math.max(0.01, expectedSpeed),
    )),
    rampTravelRatio: actualRampDistance / expectedRampDistance,
    averageRampMovementSpeed: rampMovement.reduce((sum, sample) => sum + sample.movementSpeed, 0)
      / rampMovement.length,
  };
};

const surfaceTangentSpeed = ({ surfaceDebug, linearVelocity }: CarState): number => {
  const velocity = surfaceDebug?.tangentVelocity ?? linearVelocity;
  return Math.hypot(velocity.x, velocity.y, velocity.z);
};

const surfaceClimbSpeed = ({ surfaceDebug, linearVelocity }: CarState): number => {
  const normal = surfaceDebug?.surfaceNormal;
  const velocity = surfaceDebug?.tangentVelocity ?? linearVelocity;
  return normal
    ? velocity.x * normal.y - velocity.y * normal.x
    : linearVelocity.y;
};

const forwardSpeed = (state: CarState): number => axisSpeed(state.linearVelocity, forward(state));

const axisSpeed = (
  velocity: { readonly x: number; readonly y: number; readonly z: number },
  axis: { readonly x: number; readonly y: number; readonly z: number },
): number => velocity.x * axis.x + velocity.y * axis.y + velocity.z * axis.z;

const cornerMetrics = (state: CarState): {
  readonly heading: number;
  readonly slipRatio: number;
  readonly turnRadius: number;
} => {
  const forwardAxis = forward(state);
  const rightAxis = rotate(state, { x: 1, y: 0, z: 0 });
  const longitudinalSpeed = Math.abs(axisSpeed(state.linearVelocity, forwardAxis));
  const lateralSpeed = Math.abs(axisSpeed(state.linearVelocity, rightAxis));
  return {
    heading: Math.atan2(forwardAxis.x, -forwardAxis.z),
    slipRatio: lateralSpeed / Math.max(1, longitudinalSpeed),
    turnRadius: longitudinalSpeed / Math.max(0.01, Math.abs(state.angularVelocity.y)),
  };
};

const forward = (state: CarState) => rotate(state, { x: 0, y: 0, z: -1 });
const up = (state: CarState) => rotate(state, { x: 0, y: 1, z: 0 });

const rotate = (
  { transform: { rotation } }: CarState,
  vector: { readonly x: number; readonly y: number; readonly z: number },
) => {
  const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);
  return {
    x: vector.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    y: vector.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    z: vector.z + rotation.w * tz + rotation.x * ty - rotation.y * tx,
  };
};

const yawRotationFor = (directionX: number, directionZ: number) => {
  const yaw = Math.atan2(-directionX, -directionZ);
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
};
