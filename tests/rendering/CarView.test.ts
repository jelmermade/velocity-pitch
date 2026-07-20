import { describe, expect, it } from 'vitest';
import type { CarState } from '../../src/gameplay/car/CarState';
import { WHEEL_CONNECTIONS } from '../../src/gameplay/car/WheelState';
import { CarView } from '../../src/rendering/views/CarView';

describe('car wheel rendering', () => {
  it('keeps rigid wheels attached to local mounts even when network positions are stale', () => {
    const view = new CarView();
    const state: CarState = {
      transform: {
        position: { x: 40, y: 8, z: -30 },
        rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      },
      linearVelocity: { x: 25, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      wheels: WHEEL_CONNECTIONS.map(() => ({
        connectionPoint: { x: -100, y: -100, z: -100 },
        contactPoint: { x: -100, y: -100, z: -100 },
        position: { x: -100, y: -100, z: -100 },
        grounded: true,
        suspensionLength: 0,
        steeringAngle: 0,
        spinAngle: 0,
      })),
      grounded: true,
      boost: 100,
      boosting: false,
    };

    view.update(state);

    WHEEL_CONNECTIONS.forEach((connection, index) => {
      const wheel = view.group.getObjectByName(`wheel-${index}`);
      expect(wheel?.parent).toBe(view.group);
      expect(wheel?.position.x).toBeCloseTo(connection.x);
      expect(wheel?.position.y).toBeCloseTo(connection.y);
      expect(wheel?.position.z).toBeCloseTo(connection.z);
    });
    view.dispose();
  });

  it('animates boost flames deterministically from frame delta', () => {
    const first = new CarView();
    const second = new CarView();
    const state: CarState = {
      transform: {
        position: { x: 0, y: 0.72, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      wheels: [],
      grounded: true,
      boost: 100,
      boosting: true,
    };

    first.update(state, 0.125);
    second.update(state, 0.125);
    const firstFlame = first.group.getObjectByName('boost-flame-0');
    const secondFlame = second.group.getObjectByName('boost-flame-0');
    expect(firstFlame?.scale.y).toBeCloseTo(secondFlame?.scale.y ?? 0);

    const previousScale = firstFlame?.scale.y ?? 0;
    first.update(state, 0.125);
    expect(firstFlame?.scale.y).not.toBeCloseTo(previousScale);
    first.dispose();
    second.dispose();
  });
});
