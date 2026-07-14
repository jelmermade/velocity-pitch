import { slerpQuat } from '../../core/math/Quaternion';
import { lerpVec3 } from '../../core/math/Vector3';
import type { CarState } from '../car/CarState';
import type { SimulationSnapshot } from './SimulationSnapshot';

export const interpolateSnapshots = (
  previous: SimulationSnapshot,
  current: SimulationSnapshot,
  alpha: number,
): SimulationSnapshot => ({
  tick: current.tick,
  car: interpolateCar(previous.car, current.car, alpha),
  ball: {
    ...current.ball,
    transform: {
      position: lerpVec3(previous.ball.transform.position, current.ball.transform.position, alpha),
      rotation: slerpQuat(previous.ball.transform.rotation, current.ball.transform.rotation, alpha),
    },
  },
  boostPickups: current.boostPickups,
  match: current.match,
});

const interpolateCar = (previous: CarState, current: CarState, alpha: number): CarState => ({
  ...current,
  transform: {
    position: lerpVec3(previous.transform.position, current.transform.position, alpha),
    rotation: slerpQuat(previous.transform.rotation, current.transform.rotation, alpha),
  },
  wheels: current.wheels.map((wheel, index) => {
    const oldWheel = previous.wheels[index];
    if (!oldWheel) return wheel;
    return {
      ...wheel,
      connectionPoint: lerpVec3(oldWheel.connectionPoint, wheel.connectionPoint, alpha),
      contactPoint: lerpVec3(oldWheel.contactPoint, wheel.contactPoint, alpha),
      position: lerpVec3(oldWheel.position, wheel.position, alpha),
    };
  }),
});
