import { describe, expect, it } from 'vitest';
import type { CarState } from '../../src/gameplay/car/CarState';
import { WHEEL_CONNECTIONS } from '../../src/gameplay/car/WheelState';
import { CarView } from '../../src/rendering/views/CarView';

describe('car wheel rendering', () => {
  it('keeps wheels attached to local suspension mounts even when network positions are stale', () => {
    const view = new CarView();
    const suspensionLength = 0.18;
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
        suspensionLength,
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
      expect(wheel?.position.y).toBeCloseTo(connection.y - suspensionLength);
      expect(wheel?.position.z).toBeCloseTo(connection.z);
    });
    view.dispose();
  });
});
