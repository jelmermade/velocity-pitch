import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALL_TUNING } from '../../src/core/config/BallTuning';
import type { BallState } from '../../src/gameplay/ball/BallState';
import type { BotTacticalPlan } from '../../src/gameplay/bots/BotTeamCoordinator';
import type { CarState } from '../../src/gameplay/car/CarState';
import {
  BotMatchDebugView,
  predictBallTrajectory,
} from '../../src/rendering/views/BotMatchDebugView';

const ball = (position = { x: 0, y: 8, z: 0 }, linearVelocity = { x: 4, y: 3, z: -8 }): BallState => ({
  transform: { position, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  linearVelocity,
  angularVelocity: { x: 0, y: 0, z: 0 },
});

const car: CarState = {
  transform: { position: { x: 2, y: 0.6, z: 4 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  linearVelocity: { x: 0, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  wheels: [],
  grounded: true,
  boost: 80,
  boosting: false,
};

const plan: BotTacticalPlan = {
  playerId: 'bot-azure-0',
  role: 'first',
  intent: 'challenge',
  target: { x: 12, y: 0, z: -6 },
  intercept: { x: 12, y: 0, z: -6 },
  interceptSeconds: 0.55,
  timingErrorSeconds: -0.05,
  arrivalSeconds: 0.5,
  confidence: 0.9,
  approachAlignment: 0.8,
  forwardAlignment: 0.9,
  momentum: 12,
  teammateConfidence: 0.4,
  opponentArrivalSeconds: 1,
  possession: 'team',
  challengeAllowed: true,
};

describe('bot match debug rendering', () => {
  it('shows a team-colored arrow toward each bot tactical target', () => {
    const view = new BotMatchDebugView([
      { id: 'bot-azure-0', name: 'Ace', team: 'azure', host: true, bot: true },
    ]);

    view.update(
      { 'bot-azure-0': car },
      new Map([['bot-azure-0', plan]]),
      ball(),
    );

    const arrow = view.group.getObjectByName('bot-heading-bot-azure-0') as THREE.ArrowHelper;
    expect(arrow).toBeInstanceOf(THREE.ArrowHelper);
    expect(arrow.visible).toBe(true);
    expect(arrow.position.x).toBe(car.transform.position.x);
    expect(arrow.userData.intent).toBe('challenge');
    expect(arrow.userData.target).toEqual(plan.target);

    const carHitbox = view.group.getObjectByName('car-hitbox-bot-azure-0') as THREE.Group;
    const bodyHitbox = view.group.getObjectByName(
      'car-body-hitbox-bot-azure-0',
    ) as THREE.LineSegments;
    const wheelHitboxes = [0, 1, 2, 3].map((index) => view.group.getObjectByName(
      `car-wheel-hitbox-bot-azure-0-${index}`,
    ) as THREE.LineSegments);
    expect(carHitbox).toBeInstanceOf(THREE.Group);
    expect(bodyHitbox).toBeInstanceOf(THREE.LineSegments);
    wheelHitboxes.forEach((wheelHitbox) => expect(wheelHitbox).toBeInstanceOf(THREE.LineSegments));
    expect(carHitbox.visible).toBe(true);
    expect(carHitbox.position.toArray()).toEqual([
      car.transform.position.x,
      car.transform.position.y,
      car.transform.position.z,
    ]);
    expect(carHitbox.userData.colliderType).toBe('box');
    expect(carHitbox.userData.bodyBottomY).toBeCloseTo(-0.02);
    expect(carHitbox.userData.bodyTopY).toBeCloseTo(1.08);
    expect(bodyHitbox.position.y).toBeCloseTo(0.53);
    expect(carHitbox.userData.wheelColliderType).toBe('cylinder');
    expect(carHitbox.userData.wheelDepth).toBeCloseTo(0.32);
    wheelHitboxes[0]?.geometry.computeBoundingBox();
    const wheelBounds = wheelHitboxes[0]?.geometry.boundingBox;
    expect(wheelBounds?.max.x).toBeCloseTo(0.16);
    expect(wheelBounds?.min.x).toBeCloseTo(-0.16);
    expect(wheelBounds?.max.y).toBeCloseTo(0.34);
    expect(wheelBounds?.min.y).toBeCloseTo(-0.34);
    view.dispose();
  });

  it('updates a dashed trajectory and predicts a floor bounce', () => {
    const view = new BotMatchDebugView([]);
    const fallingBall = ball(
      { x: 0, y: BALL_TUNING.radius + 0.1, z: 0 },
      { x: 0, y: -8, z: 3 },
    );

    view.update({}, new Map(), fallingBall);

    const line = view.group.getObjectByName('ball-trajectory') as THREE.Line;
    const positions = line.geometry.getAttribute('position');
    const predicted = predictBallTrajectory(fallingBall, 1, 1 / 30);
    expect(line).toBeInstanceOf(THREE.Line);
    expect(positions.count).toBeGreaterThan(20);
    expect(Math.min(...predicted.map(({ y }) => y))).toBeGreaterThanOrEqual(BALL_TUNING.radius);
    expect(predicted.some((point, index) => {
      const previous = predicted[index - 1];
      return index > 1 && previous !== undefined && point.y > previous.y;
    })).toBe(true);
    const ballHitbox = view.group.getObjectByName('ball-hitbox') as THREE.LineSegments;
    expect(ballHitbox).toBeInstanceOf(THREE.LineSegments);
    expect(ballHitbox.position.toArray()).toEqual([
      fallingBall.transform.position.x,
      fallingBall.transform.position.y,
      fallingBall.transform.position.z,
    ]);
    expect(ballHitbox.userData.radius).toBe(BALL_TUNING.radius);
    view.dispose();
  });

  it('hides arrows when tactical state is unavailable', () => {
    const view = new BotMatchDebugView([
      { id: 'bot-azure-0', name: 'Ace', team: 'azure', host: true, bot: true },
    ]);
    view.update({ 'bot-azure-0': car }, new Map(), ball());
    expect(view.group.getObjectByName('bot-heading-bot-azure-0')?.visible).toBe(false);
    expect(view.group.getObjectByName('car-hitbox-bot-azure-0')?.visible).toBe(true);
    view.update({}, new Map(), ball());
    expect(view.group.getObjectByName('car-hitbox-bot-azure-0')?.visible).toBe(false);
    view.dispose();
  });
});
