import * as THREE from 'three';
import { BALL_TUNING } from '../../core/config/BallTuning';
import { DEFAULT_CAR_TUNING } from '../../core/config/CarTuning';
import type { Vec3 } from '../../core/math/Vector3';
import type { BallState } from '../../gameplay/ball/BallState';
import { predictBallTrajectory as predictSharedBallTrajectory } from '../../gameplay/bots/BallTrajectory';
import type { BotTacticalPlan } from '../../gameplay/bots/BotTeamCoordinator';
import type { CarState } from '../../gameplay/car/CarState';
import { WHEEL_CONNECTIONS } from '../../gameplay/car/WheelState';
import type { LobbyPlayer } from '../../networking/LobbyProtocol';

const TRAJECTORY_SECONDS = 3;
const TRAJECTORY_STEP_SECONDS = 1 / 30;
const ARROW_LENGTH = 10;
const AZURE_DEBUG_COLOR = 0x42e8ff;
const CORAL_DEBUG_COLOR = 0xff765c;
const BALL_HITBOX_COLOR = 0xffef8a;
const HITBOX_RENDER_ORDER = 31;
const CAR_BODY_HITBOX_BOTTOM_Y = -0.02;
const CAR_BODY_HITBOX_TOP_Y = 1.08;
const WHEEL_HITBOX_DEPTH = 0.32;

interface CarHitboxOutline {
  readonly group: THREE.Group;
  readonly outlines: readonly THREE.LineSegments[];
  readonly wheelOutlines: readonly THREE.LineSegments[];
}

export class BotMatchDebugView {
  readonly group = new THREE.Group();
  private readonly arrows = new Map<string, THREE.ArrowHelper>();
  private readonly carHitboxes = new Map<string, CarHitboxOutline>();
  private readonly ballHitbox: THREE.LineSegments<THREE.WireframeGeometry, THREE.LineBasicMaterial>;
  private readonly trajectory: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;

  constructor(players: readonly LobbyPlayer[]) {
    this.group.name = 'bot-match-debug';
    players.filter(({ bot }) => bot).forEach((player) => {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(),
        ARROW_LENGTH,
        player.team === 'azure' ? AZURE_DEBUG_COLOR : CORAL_DEBUG_COLOR,
        1.15,
        0.65,
      );
      arrow.name = `bot-heading-${player.id}`;
      arrow.visible = false;
      arrow.line.renderOrder = 30;
      arrow.cone.renderOrder = 30;
      setTransparentDebugMaterial(arrow.line.material, 0.82);
      setTransparentDebugMaterial(arrow.cone.material, 0.92);
      this.arrows.set(player.id, arrow);
      this.group.add(arrow);

      const hitbox = createCarHitboxOutline(
        player.id,
        player.team === 'azure' ? AZURE_DEBUG_COLOR : CORAL_DEBUG_COLOR,
      );
      this.carHitboxes.set(player.id, hitbox);
      this.group.add(hitbox.group);
    });

    const ballGeometry = new THREE.SphereGeometry(BALL_TUNING.radius, 20, 12);
    const ballWireframe = new THREE.WireframeGeometry(ballGeometry);
    ballGeometry.dispose();
    this.ballHitbox = new THREE.LineSegments(
      ballWireframe,
      createHitboxMaterial(BALL_HITBOX_COLOR, 0.78),
    );
    this.ballHitbox.name = 'ball-hitbox';
    this.ballHitbox.renderOrder = HITBOX_RENDER_ORDER;
    this.ballHitbox.frustumCulled = false;
    this.ballHitbox.userData.radius = BALL_TUNING.radius;
    this.group.add(this.ballHitbox);

    this.trajectory = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: 0xffef8a,
        dashSize: 1.2,
        gapSize: 0.65,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.trajectory.name = 'ball-trajectory';
    this.trajectory.renderOrder = 29;
    this.trajectory.frustumCulled = false;
    this.group.add(this.trajectory);
  }

  update(
    carStates: Readonly<Record<string, CarState>> | undefined,
    tacticalStates: ReadonlyMap<string, BotTacticalPlan> | undefined,
    ball: BallState,
    visible = true,
  ): void {
    this.group.visible = visible;
    if (!visible) return;

    this.arrows.forEach((arrow, playerId) => {
      const car = carStates?.[playerId];
      const plan = tacticalStates?.get(playerId);
      if (!car || !plan) {
        arrow.visible = false;
        return;
      }
      const origin = car.transform.position;
      const dx = plan.target.x - origin.x;
      const dy = plan.target.y - origin.y;
      const dz = plan.target.z - origin.z;
      const targetDistance = Math.hypot(dx, dy, dz);
      if (targetDistance < 0.05) {
        arrow.visible = false;
        return;
      }
      arrow.visible = true;
      arrow.position.set(origin.x, origin.y + 1.45, origin.z);
      arrow.setDirection(new THREE.Vector3(dx, dy, dz).normalize());
      arrow.setLength(Math.min(ARROW_LENGTH, targetDistance), 1.15, 0.65);
      arrow.userData.intent = plan.intent;
      arrow.userData.role = plan.role;
      arrow.userData.target = { ...plan.target };
      arrow.userData.intercept = { ...plan.intercept };
      arrow.userData.interceptSeconds = plan.interceptSeconds;
      arrow.userData.timingErrorSeconds = plan.timingErrorSeconds;
    });

    this.carHitboxes.forEach(({ group, wheelOutlines }, playerId) => {
      const car = carStates?.[playerId];
      group.visible = car !== undefined;
      if (!car) return;
      const { position, rotation } = car.transform;
      group.position.set(position.x, position.y, position.z);
      group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      wheelOutlines.forEach((outline, index) => {
        const connection = WHEEL_CONNECTIONS[index];
        if (!connection) return;
        const wheel = car.wheels[index];
        outline.position.set(
          connection.x,
          connection.y - (wheel?.suspensionLength ?? 0),
          connection.z,
        );
        outline.quaternion.identity();
        if (!wheel) return;
        outline.rotateY(-wheel.steeringAngle);
        outline.rotateX(wheel.spinAngle);
      });
    });

    const ballPosition = ball.transform.position;
    const ballRotation = ball.transform.rotation;
    this.ballHitbox.position.set(ballPosition.x, ballPosition.y, ballPosition.z);
    this.ballHitbox.quaternion.set(
      ballRotation.x,
      ballRotation.y,
      ballRotation.z,
      ballRotation.w,
    );

    const points = predictBallTrajectory(ball).map(({ x, y, z }) => new THREE.Vector3(x, y, z));
    this.trajectory.geometry.setFromPoints(points);
    this.trajectory.computeLineDistances();
  }

  dispose(): void {
    this.arrows.forEach((arrow) => {
      arrow.line.geometry.dispose();
      arrow.cone.geometry.dispose();
      disposeMaterial(arrow.line.material);
      disposeMaterial(arrow.cone.material);
    });
    this.carHitboxes.forEach(({ outlines }) => outlines.forEach((outline) => {
      outline.geometry.dispose();
      disposeMaterial(outline.material);
    }));
    this.ballHitbox.geometry.dispose();
    this.ballHitbox.material.dispose();
    this.trajectory.geometry.dispose();
    this.trajectory.material.dispose();
  }
}

export const predictBallTrajectory = (
  state: BallState,
  durationSeconds = TRAJECTORY_SECONDS,
  stepSeconds = TRAJECTORY_STEP_SECONDS,
): readonly Vec3[] => predictSharedBallTrajectory(
  state.transform.position,
  state.linearVelocity,
  durationSeconds,
  stepSeconds,
);

const setTransparentDebugMaterial = (
  material: THREE.Material | THREE.Material[],
  opacity: number,
): void => {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((entry) => {
    entry.transparent = true;
    entry.opacity = opacity;
    entry.depthTest = false;
    entry.depthWrite = false;
  });
};

const createCarHitboxOutline = (playerId: string, color: number): CarHitboxOutline => {
  const group = new THREE.Group();
  group.name = `car-hitbox-${playerId}`;
  group.visible = false;
  group.userData.colliderType = 'box';
  group.userData.bodyBottomY = CAR_BODY_HITBOX_BOTTOM_Y;
  group.userData.bodyTopY = CAR_BODY_HITBOX_TOP_Y;
  group.userData.wheelColliderType = 'cylinder';
  group.userData.wheelDepth = WHEEL_HITBOX_DEPTH;

  const bodyBorder = DEFAULT_CAR_TUNING.colliderBorderRadius;
  const bodyHeight = CAR_BODY_HITBOX_TOP_Y - CAR_BODY_HITBOX_BOTTOM_Y;
  const bodyGeometry = new THREE.BoxGeometry(
    2 * (DEFAULT_CAR_TUNING.halfExtents.x + bodyBorder),
    bodyHeight,
    2 * (DEFAULT_CAR_TUNING.halfExtents.z + bodyBorder),
  );
  const bodyOutline = createGeometryOutline(
    bodyGeometry,
    color,
    0.82,
    `car-body-hitbox-${playerId}`,
  );
  bodyOutline.position.y = CAR_BODY_HITBOX_BOTTOM_Y + bodyHeight * 0.5;

  const wheelOutlines = WHEEL_CONNECTIONS.map((connection, index) => {
    const wheelGeometry = new THREE.CylinderGeometry(
      DEFAULT_CAR_TUNING.wheelRadius,
      DEFAULT_CAR_TUNING.wheelRadius,
      WHEEL_HITBOX_DEPTH,
      20,
      1,
      false,
    );
    wheelGeometry.rotateZ(Math.PI / 2);
    const outline = createGeometryOutline(
      wheelGeometry,
      color,
      0.72,
      `car-wheel-hitbox-${playerId}-${index}`,
    );
    outline.position.set(connection.x, connection.y, connection.z);
    return outline;
  });

  group.add(bodyOutline, ...wheelOutlines);
  return { group, outlines: [bodyOutline, ...wheelOutlines], wheelOutlines };
};

const createGeometryOutline = (
  geometry: THREE.BufferGeometry,
  color: number,
  opacity: number,
  name: string,
): THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> => {
  const edges = new THREE.EdgesGeometry(geometry, 1);
  geometry.dispose();
  const outline = new THREE.LineSegments(edges, createHitboxMaterial(color, opacity));
  outline.name = name;
  outline.renderOrder = HITBOX_RENDER_ORDER;
  outline.frustumCulled = false;
  return outline;
};

const createHitboxMaterial = (
  color: number,
  opacity: number,
): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  (Array.isArray(material) ? material : [material]).forEach((entry) => entry.dispose());
};
