import { expect, test, type Page } from '@playwright/test';
import type { E2EBotTickResult, VelocityPitchE2EApi } from '../src/app/E2ETestApi';
import type { Vec3 } from '../src/core/math/Vector3';

const VISUAL_PLAYBACK = process.env.E2E_VISUAL === '1';
const TICKS_PER_BATCH = VISUAL_PLAYBACK ? 3 : 12;
const BOT_ID = 'bot-coral-0';

type ScenarioKind =
  | 'ground'
  | 'high-rising'
  | 'high-lateral'
  | 'wall-bounce'
  | 'lateral-crossing'
  | 'moving-away'
  | 'side-on-stationary';

interface BotBallScenario {
  readonly kind: ScenarioKind;
  readonly seed: number;
  readonly durationSeconds: number;
  readonly carPosition: Vec3;
  readonly ballPosition: Vec3;
  readonly ballVelocity: Vec3;
  readonly minimumContactHeight: number;
  readonly minimumContactSpeed: number;
  readonly requireAirborneBot: boolean;
  readonly evaluateFinalVelocity: boolean;
  readonly minimumGoalAlignment?: number;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'SINGLE PLAYER' }).click();
  await page.locator('[name="team-size"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'START 1V1 MATCH' }).click();
  await expect(page.locator('[data-render-layer] canvas')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__velocityPitchE2E))).toBe(true);
  await page.evaluate((botId) => {
    const api = window.__velocityPitchE2E;
    if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
    api.focusCar(botId);
    api.finishCountdown();
  }, BOT_ID);
  await expect.poll(() => page.evaluate(() => window.__velocityPitchE2E?.focusedCarId())).toBe(BOT_ID);
  await installScenarioOverlay(page);
});

for (const entry of [
  { kind: 'ground', seed: 0x51a7, label: 'random rolling ground ball' },
  { kind: 'high-rising', seed: 0xa113, label: 'very high rising moving shot' },
  { kind: 'high-lateral', seed: 0xd35c, label: 'very high lateral moving shot' },
  { kind: 'wall-bounce', seed: 0xb04c, label: 'random side-wall rebound' },
  { kind: 'lateral-crossing', seed: 0xc2055, label: 'fast lateral crossing interception' },
  { kind: 'moving-away', seed: 0xa4a7, label: 'moving-away ball interception' },
  { kind: 'side-on-stationary', seed: 0x51de, label: 'side-on stationary ball setup' },
] as const) {
  test(`bot contact: ${entry.label}`, async ({ page }) => {
    test.setTimeout(240_000);
    const setup = await page.evaluate(() => {
      const api = window.__velocityPitchE2E;
      if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
      return {
        arena: api.arena,
        opponentGoal: api.goals.find(({ teamScored }) => teamScored === 'coral'),
      };
    });
    const { arena, opponentGoal } = setup;
    if (!opponentGoal) throw new Error('Coral attacking goal is unavailable');
    const scenario = createScenario(entry.kind, entry.seed, arena);

    if (scenario.kind === 'side-on-stationary') {
      await page.evaluate(() => {
        const api = window.__velocityPitchE2E;
        if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
        api.advanceBotTicks(240);
      });
    }

    await page.evaluate(({ botId, nextScenario }) => {
      const api = window.__velocityPitchE2E;
      if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
      api.stageCar('local', {
        transform: {
          position: { x: -api.arena.halfWidth + 8, y: 0.72, z: api.arena.halfLength - 10 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      });
      api.stageCar(botId, {
        transform: { position: nextScenario.carPosition, rotation: { x: 0, y: 1, z: 0, w: 0 } },
      });
      api.stageBall({
        position: nextScenario.ballPosition,
        linearVelocity: nextScenario.ballVelocity,
      });
    }, { botId: BOT_ID, nextScenario: scenario });

    const totalTicks = Math.ceil(scenario.durationSeconds * 60);
    const contactIds = new Set<string>();
    const contacts: E2EBotTickResult['ballContacts'][number][] = [];
    let closestDistance = Number.POSITIVE_INFINITY;
    let sawWallBounce = false;
    let previousWallVelocity = scenario.ballVelocity.x;
    let botContact: E2EBotTickResult['ballContacts'][number] | undefined;

    for (let elapsedTicks = 0; elapsedTicks < totalTicks && !botContact;) {
      const ticks = Math.min(TICKS_PER_BATCH, totalTicks - elapsedTicks);
      const result = await page.evaluate((tickCount) => {
        const api = window.__velocityPitchE2E;
        if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
        return api.advanceBotTicks(tickCount);
      }, ticks);
      elapsedTicks += ticks;
      result.ballContactPlayerIds.forEach((playerId) => contactIds.add(playerId));
      contacts.push(...result.ballContacts);
      botContact = contacts.find((contact) => contact.playerId === BOT_ID
        && (scenario.kind !== 'side-on-stationary' || contactVelocityDelta(contact) > 0.25));
      const bot = result.cars[BOT_ID];
      const distance = distance3D(bot.transform.position, result.ball.transform.position);
      closestDistance = Math.min(closestDistance, distance);
      if (scenario.kind === 'wall-bounce'
        && Math.sign(previousWallVelocity) !== Math.sign(result.ball.linearVelocity.x)) {
        sawWallBounce = true;
      }
      previousWallVelocity = result.ball.linearVelocity.x;
      await updateScenarioOverlay(page, scenario, result, distance, elapsedTicks / 60);
      if (VISUAL_PLAYBACK) await page.waitForTimeout(50);
    }

    const context = JSON.stringify({ scenario, closestDistance, contactIds: [...contactIds], botContact });
    expect(botContact, context).toBeDefined();
    expect(botContact?.ball.transform.position.y ?? 0, context).toBeGreaterThanOrEqual(
      scenario.minimumContactHeight,
    );
    expect(ballSpeed(botContact?.ball.linearVelocity ?? { x: 0, y: 0, z: 0 }), context).toBeGreaterThan(
      scenario.minimumContactSpeed,
    );
    if (scenario.requireAirborneBot) expect(botContact?.car.grounded, context).toBe(false);
    if (scenario.kind === 'wall-bounce') expect(sawWallBounce, context).toBe(true);
    const shotOutcome = await page.evaluate(() => {
      const api = window.__velocityPitchE2E;
      if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
      return api.advanceBotTicks(8);
    });
    const impact = scenario.evaluateFinalVelocity
      ? shotOutcome.ball.linearVelocity
      : botContact ? {
          x: shotOutcome.ball.linearVelocity.x - botContact.ballBeforeContact.linearVelocity.x,
          z: shotOutcome.ball.linearVelocity.z - botContact.ballBeforeContact.linearVelocity.z,
        } : { x: 0, z: 0 };
    const toGoal = {
      x: opponentGoal.center.x - shotOutcome.ball.transform.position.x,
      z: opponentGoal.center.z - shotOutcome.ball.transform.position.z,
    };
    const goalAlignment = horizontalAlignment(impact, toGoal);
    expect(goalAlignment, context).toBeGreaterThan(scenario.minimumGoalAlignment ?? 0.35);
    expect(impact.z, context).toBeGreaterThan(0.5);
    await showShotOutcome(page, goalAlignment, impact.z);
    if (VISUAL_PLAYBACK) await page.waitForTimeout(700);
  });
}

const createScenario = (
  kind: ScenarioKind,
  seed: number,
  arena: VelocityPitchE2EApi['arena'],
): BotBallScenario => {
  const random = seededRandom(seed);
  const jitter = (amount: number): number => (random() * 2 - 1) * amount;
  if (kind === 'ground') {
    return {
      kind,
      seed,
      durationSeconds: 7,
      carPosition: { x: -5 + jitter(1.5), y: 0.72, z: -16 + jitter(1) },
      ballPosition: { x: 3 + jitter(1.5), y: arena.ballRadius + 0.08, z: -1 + jitter(1) },
      ballVelocity: { x: 2.5 + jitter(0.8), y: 0, z: 1 + jitter(0.5) },
      minimumContactHeight: 0,
      minimumContactSpeed: 0.5,
      requireAirborneBot: false,
      evaluateFinalVelocity: false,
    };
  }
  if (kind === 'side-on-stationary') {
    return {
      kind,
      seed,
      durationSeconds: 9,
      carPosition: { x: 14 + jitter(0.4), y: 0.72, z: -1 + jitter(0.25) },
      ballPosition: { x: jitter(0.15), y: arena.ballRadius + 0.08, z: jitter(0.15) },
      ballVelocity: { x: 0, y: 0, z: 0 },
      minimumContactHeight: 0,
      minimumContactSpeed: 0.5,
      minimumGoalAlignment: 0.15,
      requireAirborneBot: false,
      evaluateFinalVelocity: false,
    };
  }
  if (kind === 'high-rising') {
    return {
      kind,
      seed,
      durationSeconds: 9,
      carPosition: { x: -1 + jitter(0.35), y: 0.72, z: -12 + jitter(0.35) },
      ballPosition: { x: 1 + jitter(0.3), y: 9 + jitter(0.2), z: -3 + jitter(0.3) },
      ballVelocity: { x: 1.5 + jitter(0.25), y: 10 + jitter(0.4), z: 2 + jitter(0.25) },
      minimumContactHeight: 6,
      minimumContactSpeed: 2,
      requireAirborneBot: true,
      evaluateFinalVelocity: false,
    };
  }
  if (kind === 'high-lateral') {
    return {
      kind,
      seed,
      durationSeconds: 9,
      carPosition: { x: -2 + jitter(0.35), y: 0.72, z: -12 + jitter(0.35) },
      ballPosition: { x: -4 + jitter(0.3), y: 9 + jitter(0.2), z: -3 + jitter(0.3) },
      ballVelocity: { x: 5 + jitter(0.3), y: 9 + jitter(0.4), z: 2 + jitter(0.25) },
      minimumContactHeight: 6,
      minimumContactSpeed: 2,
      requireAirborneBot: true,
      evaluateFinalVelocity: false,
    };
  }
  if (kind === 'lateral-crossing') {
    return {
      kind,
      seed,
      durationSeconds: 8,
      carPosition: { x: jitter(0.7), y: 0.72, z: -18 + jitter(0.7) },
      ballPosition: {
        x: -12 + jitter(0.7),
        y: arena.ballRadius + 0.08,
        z: -3 + jitter(0.6),
      },
      ballVelocity: { x: 11 + jitter(0.7), y: 0, z: 0.5 + jitter(0.25) },
      minimumContactHeight: 0,
      minimumContactSpeed: 2,
      requireAirborneBot: false,
      evaluateFinalVelocity: false,
    };
  }
  if (kind === 'moving-away') {
    return {
      kind,
      seed,
      durationSeconds: 8,
      carPosition: { x: -2 + jitter(0.7), y: 0.72, z: -18 + jitter(0.7) },
      ballPosition: {
        x: 1 + jitter(0.5),
        y: arena.ballRadius + 0.08,
        z: -5 + jitter(0.5),
      },
      ballVelocity: { x: 0.5 + jitter(0.2), y: 0, z: 8 + jitter(0.7) },
      minimumContactHeight: 0,
      minimumContactSpeed: 1,
      requireAirborneBot: false,
      evaluateFinalVelocity: false,
    };
  }
  const side = random() < 0.5 ? -1 : 1;
  return {
    kind,
    seed,
    durationSeconds: 8,
    carPosition: { x: side * (arena.halfWidth - 37 + jitter(0.5)), y: 0.72, z: -13 + jitter(0.6) },
    ballPosition: {
      x: side * (arena.halfWidth - 4 + jitter(0.4)),
      y: arena.ballRadius + 0.2,
      z: -1 + jitter(1),
    },
    ballVelocity: { x: side * (16 + jitter(1.5)), y: 0, z: 1 + jitter(0.4) },
    minimumContactHeight: 0,
    minimumContactSpeed: 0.5,
    requireAirborneBot: false,
    evaluateFinalVelocity: true,
  };
};

const installScenarioOverlay = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const overlay = document.createElement('aside');
    overlay.dataset.botContactScenario = '';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '90px',
      left: '24px',
      zIndex: '10000',
      minWidth: '330px',
      padding: '14px 16px',
      color: '#d9fff8',
      background: 'rgba(3, 16, 22, 0.88)',
      border: '1px solid #45f0cf',
      font: '700 13px/1.55 monospace',
      whiteSpace: 'pre-line',
      pointerEvents: 'none',
    });
    document.body.append(overlay);
  });
};

const updateScenarioOverlay = async (
  page: Page,
  scenario: BotBallScenario,
  result: E2EBotTickResult,
  distance: number,
  elapsedSeconds: number,
): Promise<void> => {
  await page.evaluate(({ botId, nextScenario, nextResult, nextDistance, nextElapsed }) => {
    const overlay = document.querySelector<HTMLElement>('[data-bot-contact-scenario]');
    const bot = nextResult.cars[botId];
    if (!overlay) return;
    const contacted = nextResult.ballContactPlayerIds.includes(botId);
    overlay.textContent = [
      `BOT INTERCEPT // ${nextScenario.kind.toUpperCase()} // SEED ${nextScenario.seed}`,
      `CAMERA // ${botId.toUpperCase()} CHASE + BALL VIEW`,
      `TIME ${nextElapsed.toFixed(2)}s   DIST ${nextDistance.toFixed(2)}`,
      `BOT  X ${bot.transform.position.x.toFixed(1)} Y ${bot.transform.position.y.toFixed(1)} Z ${bot.transform.position.z.toFixed(1)}`,
      `BALL X ${nextResult.ball.transform.position.x.toFixed(1)} Y ${nextResult.ball.transform.position.y.toFixed(1)} Z ${nextResult.ball.transform.position.z.toFixed(1)}`,
      `BALL VEL ${Math.hypot(
        nextResult.ball.linearVelocity.x,
        nextResult.ball.linearVelocity.y,
        nextResult.ball.linearVelocity.z,
      ).toFixed(1)} U/S`,
      contacted ? 'CONTACT // CONFIRMED' : 'PREDICTING INTERCEPT…',
    ].join('\n');
    overlay.style.borderColor = contacted ? '#fff36b' : '#45f0cf';
  }, {
    botId: BOT_ID,
    nextScenario: scenario,
    nextResult: result,
    nextDistance: distance,
    nextElapsed: elapsedSeconds,
  });
};

const showShotOutcome = async (
  page: Page,
  goalAlignment: number,
  goalProgressSpeed: number,
): Promise<void> => {
  await page.evaluate(({ alignment, progress }) => {
    const overlay = document.querySelector<HTMLElement>('[data-bot-contact-scenario]');
    if (!overlay) return;
    overlay.textContent += `\nATTACK SHOT // GOAL ALIGN ${alignment.toFixed(2)} // FORWARD +${progress.toFixed(1)}`;
    overlay.style.borderColor = alignment > 0.35 && progress > 0.5
      ? '#fff36b'
      : '#ff6b6b';
  }, { alignment: goalAlignment, progress: goalProgressSpeed });
};

const distance3D = (left: Vec3, right: Vec3): number => Math.hypot(
  right.x - left.x,
  right.y - left.y,
  right.z - left.z,
);

const ballSpeed = (velocity: Vec3): number => Math.hypot(velocity.x, velocity.y, velocity.z);

const contactVelocityDelta = (contact: E2EBotTickResult['ballContacts'][number]): number => Math.hypot(
  contact.ball.linearVelocity.x - contact.ballBeforeContact.linearVelocity.x,
  contact.ball.linearVelocity.y - contact.ballBeforeContact.linearVelocity.y,
  contact.ball.linearVelocity.z - contact.ballBeforeContact.linearVelocity.z,
);

const horizontalAlignment = (
  left: Pick<Vec3, 'x' | 'z'>,
  right: Pick<Vec3, 'x' | 'z'>,
): number => (
  (left.x * right.x + left.z * right.z)
  / Math.max(0.0001, Math.hypot(left.x, left.z) * Math.hypot(right.x, right.z))
);

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
};
