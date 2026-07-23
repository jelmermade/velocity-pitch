import { expect, test, type Page } from '@playwright/test';
import type { BotTacticalPlan } from '../src/gameplay/bots/BotTeamCoordinator';
import type { LobbyPlayer, TeamId } from '../src/networking/LobbyProtocol';

const VISUAL_PLAYBACK = process.env.E2E_VISUAL === '1';
const TICKS_PER_BATCH = VISUAL_PLAYBACK ? 3 : 30;

test('3v3 bots maintain roles, yield challenges, and rotate after the play', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /3V3 BOT LAB/ }).click();
  await expect(page.locator('[data-render-layer] canvas')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean(window.__velocityPitchE2E))).toBe(true);
  const setup = await page.evaluate(() => {
    const api = window.__velocityPitchE2E;
    if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
    api.finishCountdown();
    return { players: api.players, goals: api.goals, arena: api.arena };
  });
  const players = setup.players;
  const focusPlayer = players.find(({ team }) => team === 'azure') ?? players[0];
  await installTeamOverlay(page);

  await page.evaluate(({ roster, focusId, ballRadius }) => {
    const api = window.__velocityPitchE2E;
    if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
    for (const team of ['azure', 'coral'] as const) {
      const attackDirection = Math.sign(
        api.goals.find(({ teamScored }) => teamScored === team)?.center.z ?? 1,
      );
      const rotation = attackDirection < 0
        ? { x: 0, y: 0, z: 0, w: 1 }
        : { x: 0, y: 1, z: 0, w: 0 };
      roster
        .filter((player) => player.team === team)
        .sort((left, right) => left.id.localeCompare(right.id))
        .forEach((player, index) => {
          const lanes = [
            { x: team === 'azure' ? -3 : 3, depth: 9 },
            { x: team === 'azure' ? 11 : -11, depth: 24 },
            { x: team === 'azure' ? -7 : 7, depth: 43 },
          ];
          const lane = lanes[index];
          api.stageCar(player.id, {
            transform: {
              position: { x: lane.x, y: 0.72, z: -attackDirection * lane.depth },
              rotation,
            },
          });
        });
    }
    api.stageBall({
      position: { x: 1.5, y: ballRadius + 0.08, z: 0 },
      linearVelocity: { x: 3.5, y: 0, z: 1.5 },
    });
    api.focusCar(focusId);
    api.advanceBotTicks(1);
  }, { roster: players, focusId: focusPlayer.id, ballRadius: setup.arena.ballRadius });

  const previousRoles = new Map<string, BotTacticalPlan['role']>();
  const contacts = new Set<string>();
  let roleChanges = 0;
  let rotationSamples = 0;
  let supportSamples = 0;
  let coverSamples = 0;
  let doubleCommitSamples = 0;
  let invalidRoleSamples = 0;
  let spacingTotal = 0;
  let spacingSamples = 0;
  let clusteredSamples = 0;
  const totalTicks = 60 * 12;

  for (let elapsed = 0; elapsed < totalTicks;) {
    const ticks = Math.min(TICKS_PER_BATCH, totalTicks - elapsed);
    const result = await page.evaluate((tickCount) => {
      const api = window.__velocityPitchE2E;
      if (!api) throw new Error('Velocity Pitch e2e API is unavailable');
      return api.advanceBotTicks(tickCount);
    }, ticks);
    elapsed += ticks;
    result.ballContactPlayerIds.forEach((playerId) => contacts.add(playerId));

    for (const team of ['azure', 'coral'] as const) {
      const teamPlayers = players.filter((player) => player.team === team);
      const plans = teamPlayers.flatMap((player) => {
        const plan = result.tacticalStates[player.id];
        return plan ? [plan] : [];
      });
      const roleCounts = countRoles(plans);
      if (roleCounts.first !== 1 || roleCounts.second !== 1 || roleCounts.third !== 1) {
        invalidRoleSamples += 1;
      }
      if (plans.filter(({ intent }) => intent === 'challenge').length > 1) doubleCommitSamples += 1;
      rotationSamples += plans.filter(({ intent }) => intent === 'rotate').length;
      supportSamples += plans.filter(({ intent }) => intent === 'support').length;
      coverSamples += plans.filter(({ intent }) => intent === 'cover').length;
      plans.forEach((plan) => {
        const previous = previousRoles.get(plan.playerId);
        if (previous && previous !== plan.role) roleChanges += 1;
        previousRoles.set(plan.playerId, plan.role);
      });
      teamPlayers.forEach((player, index) => {
        const car = result.cars[player.id];
        const nearest = teamPlayers.reduce((minimum, teammate, teammateIndex) => {
          const teammateCar = result.cars[teammate.id];
          if (teammateIndex === index) return minimum;
          return Math.min(minimum, Math.hypot(
            teammateCar.transform.position.x - car.transform.position.x,
            teammateCar.transform.position.z - car.transform.position.z,
          ));
        }, Number.POSITIVE_INFINITY);
        if (!Number.isFinite(nearest)) return;
        spacingTotal += nearest;
        spacingSamples += 1;
        if (nearest < 6) clusteredSamples += 1;
      });
    }
    await updateTeamOverlay(page, players, result.tacticalStates, contacts, elapsed / 60);
    if (VISUAL_PLAYBACK) await page.waitForTimeout(50);
  }

  const context = JSON.stringify({
    contacts: [...contacts],
    roleChanges,
    rotationSamples,
    supportSamples,
    coverSamples,
    doubleCommitSamples,
    invalidRoleSamples,
    averageSpacing: spacingTotal / Math.max(1, spacingSamples),
    clusteredRate: clusteredSamples / Math.max(1, spacingSamples),
  });
  expect(invalidRoleSamples, context).toBe(0);
  expect(doubleCommitSamples, context).toBe(0);
  expect(roleChanges, context).toBeGreaterThan(0);
  expect(rotationSamples, context).toBeGreaterThan(0);
  expect(supportSamples, context).toBeGreaterThan(0);
  expect(coverSamples, context).toBeGreaterThan(0);
  expect(contacts.size, context).toBeGreaterThan(0);
  expect(spacingTotal / Math.max(1, spacingSamples), context).toBeGreaterThan(10);
  expect(clusteredSamples / Math.max(1, spacingSamples), context).toBeLessThan(0.12);
  if (VISUAL_PLAYBACK) await page.waitForTimeout(1_000);
});

const countRoles = (plans: readonly BotTacticalPlan[]): Record<BotTacticalPlan['role'], number> => ({
  first: plans.filter(({ role }) => role === 'first').length,
  second: plans.filter(({ role }) => role === 'second').length,
  third: plans.filter(({ role }) => role === 'third').length,
});

const installTeamOverlay = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const overlay = document.createElement('pre');
    overlay.dataset.botTeamRotation = 'true';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '18px',
      left: '18px',
      zIndex: '99999',
      margin: '0',
      padding: '14px 16px',
      color: '#eafffb',
      background: 'rgba(4, 12, 18, 0.84)',
      border: '1px solid #45f0cf',
      font: '600 13px/1.45 monospace',
      pointerEvents: 'none',
    });
    document.body.append(overlay);
  });
};

const updateTeamOverlay = async (
  page: Page,
  players: readonly LobbyPlayer[],
  plans: Readonly<Partial<Record<string, BotTacticalPlan>>>,
  contacts: ReadonlySet<string>,
  elapsedSeconds: number,
): Promise<void> => {
  await page.evaluate(({ roster, tacticalPlans, touched, elapsed }) => {
    const overlay = document.querySelector<HTMLElement>('[data-bot-team-rotation]');
    if (!overlay) return;
    const lines = [`TEAM AI // ${elapsed.toFixed(1)}s // TOUCHES ${touched.length}`];
    for (const team of ['azure', 'coral'] as TeamId[]) {
      lines.push(``, team.toUpperCase());
      roster
        .filter((player) => player.team === team)
        .sort((left, right) => (tacticalPlans[left.id]?.role ?? '').localeCompare(
          tacticalPlans[right.id]?.role ?? '',
        ))
        .forEach((player) => {
          const plan = tacticalPlans[player.id];
          if (!plan) return;
          lines.push(`${plan.role.toUpperCase().padEnd(6)} ${plan.intent.padEnd(14)} ${player.name.replace(' [BOT]', '')}`);
        });
    }
    overlay.textContent = lines.join('\n');
  }, { roster: players, tacticalPlans: plans, touched: [...contacts], elapsed: elapsedSeconds });
};
