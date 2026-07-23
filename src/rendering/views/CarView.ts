import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rotateVector } from '../../core/math/Quaternion';
import { length, normalize, scale, sub, type Vec3 } from '../../core/math/Vector3';
import type { CarState } from '../../gameplay/car/CarState';
import { WHEEL_CONNECTIONS } from '../../gameplay/car/WheelState';
import type { TeamId } from '../../networking/LobbyProtocol';

export class CarView {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly boostFlames: THREE.Mesh[] = [];
  private readonly physicsDebugEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('vehicleDebug') === '1';
  private readonly debugGroup = new THREE.Group();
  private readonly debugRays: THREE.ArrowHelper[] = [];
  private readonly debugVectors: Record<string, THREE.ArrowHelper> = {};
  private animationSeconds = 0;

  constructor(team: TeamId = 'azure') {
    const bodyColor = team === 'azure' ? 0x078eaa : 0xc94836;
    const highlightColor = team === 'azure' ? 0x7de3e5 : 0xff9a78;
    const body = new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      metalness: 0.68,
      roughness: 0.2,
      clearcoat: 0.9,
      clearcoatRoughness: 0.16,
    });
    const bodyHighlight = new THREE.MeshPhysicalMaterial({
      color: highlightColor,
      metalness: 0.62,
      roughness: 0.18,
      clearcoat: 0.75,
      clearcoatRoughness: 0.14,
    });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x071014, metalness: 0.62, roughness: 0.28 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x18252a, metalness: 0.84, roughness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x092a35,
      metalness: 0.48,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });

    // Keep the shell above the wheels so its physical and visible underside clear wall fillets.
    const rideHeight = 0.14;
    this.addRoundedPart(1.72, 0.2, 2.86, 0.08, carbon, 0, -0.06 + rideHeight, 0.04, 0, 'body-undertray');
    this.addRoundedPart(1.82, 0.54, 2.54, 0.17, body, 0, 0.08 + rideHeight, 0.02, 0, 'body-chassis');
    this.addWedgePart(1.68, 0.38, 1.02, 0.16, 0.38, bodyHighlight, 0, 0.26 + rideHeight, -0.91, 'hood-wedge');
    this.addRoundedPart(1.9, 0.14, 0.3, 0.05, carbon, 0, -0.01 + rideHeight, -1.46, -0.04, 'front-splitter');
    this.addRoundedPart(1.56, 0.18, 0.7, 0.07, body, 0, 0.27 + rideHeight, 1.02, 0.06, 'rear-deck');
    this.addRoundedPart(1.34, 0.56, 1.04, 0.14, glass, 0, 0.57 + rideHeight, 0.12, -0.06, 'cockpit');
    this.addRoundedPart(1.06, 0.11, 0.66, 0.045, carbon, 0, 0.88 + rideHeight, 0.2, 0, 'roof-spine');

    for (const x of [-0.82, 0.82]) {
      const side = x < 0 ? 'left' : 'right';
      for (const z of [-0.96, 0.96]) {
        const end = z < 0 ? 'front' : 'rear';
        this.addRoundedPart(0.38, 0.36, 0.72, 0.11, body, x, 0.16 + rideHeight, z, 0, `${side}-${end}-fender`);
      }
      this.addRoundedPart(0.16, 0.16, 1.9, 0.045, carbon, x * 1.09, 0.01 + rideHeight, 0.03, 0, `${side}-side-skirt`);
      this.addRoundedPart(0.07, 0.08, 1.42, 0.025, bodyHighlight, x * 1.13, 0.2 + rideHeight, 0.03, 0, `${side}-side-accent`);
      this.addWedgePart(0.22, 0.22, 0.58, 0.08, 0.2, carbon, x * 0.86, 0.35 + rideHeight, 0.58, `${side}-rear-intake`);
    }

    this.addLights(rideHeight);
    this.addRearDiffuser(carbon, darkMetal, rideHeight);
    this.addSpoiler(carbon, bodyHighlight, rideHeight);
    this.createWheels(carbon, darkMetal, bodyHighlight);
    this.createBoostFlames();
    this.createPhysicsDebug();
  }

  update(state: CarState, deltaSeconds = 0): void {
    this.animationSeconds += deltaSeconds;
    const { position, rotation } = state.transform;
    this.group.position.set(position.x, position.y, position.z);
    this.group.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    this.boostFlames.forEach((flame, index) => {
      flame.visible = state.boosting;
      const flicker = state.boosting
        ? 0.98 + Math.sin(this.animationSeconds * 38 + index * 1.7) * 0.16
        : 0;
      flame.scale.set(1 + index * 0.04, flicker, 1 + index * 0.04);
    });

    this.wheels.forEach((wheel, index) => {
      const stateWheel = state.wheels[index];
      if (!stateWheel) {
        wheel.visible = false;
        return;
      }
      wheel.visible = true;
      const connection = WHEEL_CONNECTIONS[index];
      if (!connection) return;
      wheel.position.set(connection.x, connection.y - stateWheel.suspensionLength, connection.z);
      wheel.quaternion.identity();
      wheel.rotateY(-stateWheel.steeringAngle);
      wheel.rotateX(stateWheel.spinAngle);
    });
    this.updatePhysicsDebug(state);
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const collect = (object: THREE.Object3D): void => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
      geometries.add(object.geometry as THREE.BufferGeometry);
      const material = object.material as THREE.Material | THREE.Material[];
      (Array.isArray(material) ? material : [material]).forEach((entry) => materials.add(entry));
    };
    this.group.traverse(collect);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  private createPhysicsDebug(): void {
    this.debugGroup.name = 'vehicle-physics-debug';
    this.debugGroup.visible = this.physicsDebugEnabled;
    for (let index = 0; index < WHEEL_CONNECTIONS.length; index += 1) {
      const ray = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, 0xffc857, 0.12, 0.07);
      ray.name = `surface-ray-${index}`;
      this.debugRays.push(ray);
      this.debugGroup.add(ray);
    }
    const vectors = [
      ['surface-normal', 0x44dd88],
      ['projected-forward', 0x33ddff],
      ['velocity', 0xffcc33],
      ['tangent-velocity', 0xff55cc],
      ['adhesion-force', 0xff5544],
      ['throttle-force', 0x4488ff],
    ] as const;
    vectors.forEach(([name, color]) => {
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, color, 0.18, 0.1);
      arrow.name = name;
      this.debugVectors[name] = arrow;
      this.debugGroup.add(arrow);
    });
    this.group.add(this.debugGroup);
  }

  private updatePhysicsDebug(state: CarState): void {
    if (!this.physicsDebugEnabled || !state.surfaceDebug) return;
    const debug = state.surfaceDebug;
    this.debugGroup.userData.grounded = debug.grounded;
    debug.rays.forEach((ray, index) => {
      const arrow = this.debugRays[index];
      if (!arrow) return;
      this.updateDebugArrow(arrow, ray.origin, scale(ray.direction, ray.length), 1, state);
      arrow.setColor(new THREE.Color(ray.hitPoint ? 0x44dd88 : 0xff5544));
    });
    const origin = state.transform.position;
    this.updateDebugArrow(this.debugVectors['surface-normal'], origin, debug.surfaceNormal ?? { x: 0, y: 0, z: 0 }, 2, state);
    this.updateDebugArrow(this.debugVectors['projected-forward'], origin, debug.projectedForward, 2, state);
    this.updateDebugArrow(this.debugVectors.velocity, origin, debug.velocity, 0.12, state);
    this.updateDebugArrow(this.debugVectors['tangent-velocity'], origin, debug.tangentVelocity, 0.12, state);
    this.updateDebugArrow(this.debugVectors['adhesion-force'], origin, debug.adhesionForce, 0.000_008, state);
    this.updateDebugArrow(this.debugVectors['throttle-force'], origin, debug.throttleForce, 0.000_08, state);
  }

  private updateDebugArrow(
    arrow: THREE.ArrowHelper | undefined,
    worldOrigin: Vec3,
    worldVector: Vec3,
    vectorScale: number,
    state: CarState,
  ): void {
    if (!arrow) return;
    const rotation = state.transform.rotation;
    const inverseRotation = { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
    const localOrigin = rotateVector(inverseRotation, sub(worldOrigin, state.transform.position));
    const localVector = rotateVector(inverseRotation, worldVector);
    const magnitude = length(localVector) * vectorScale;
    arrow.position.set(localOrigin.x, localOrigin.y, localOrigin.z);
    arrow.visible = magnitude > 1e-5;
    if (!arrow.visible) return;
    const direction = normalize(localVector);
    arrow.setDirection(new THREE.Vector3(direction.x, direction.y, direction.z));
    arrow.setLength(magnitude, Math.min(0.18, magnitude * 0.3), Math.min(0.1, magnitude * 0.2));
  }

  private addRoundedPart(
    width: number,
    height: number,
    depth: number,
    radius: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    pitch = 0,
    name = '',
  ): void {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 4, radius), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = pitch;
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addWedgePart(
    width: number,
    height: number,
    depth: number,
    frontHeight: number,
    rearHeight: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    name: string,
  ): void {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const halfDepth = depth * 0.5;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -halfWidth, -halfHeight, -halfDepth, halfWidth, -halfHeight, -halfDepth,
      -halfWidth, -halfHeight + frontHeight, -halfDepth, halfWidth, -halfHeight + frontHeight, -halfDepth,
      -halfWidth, -halfHeight, halfDepth, halfWidth, -halfHeight, halfDepth,
      -halfWidth, -halfHeight + rearHeight, halfDepth, halfWidth, -halfHeight + rearHeight, halfDepth,
    ], 3));
    geometry.setIndex([
      0, 2, 3, 0, 3, 1,
      4, 5, 7, 4, 7, 6,
      0, 4, 6, 0, 6, 2,
      1, 3, 7, 1, 7, 5,
      0, 1, 5, 0, 5, 4,
      2, 6, 7, 2, 7, 3,
    ]);
    const flatGeometry = geometry.toNonIndexed();
    geometry.dispose();
    flatGeometry.computeVertexNormals();
    const mesh = new THREE.Mesh(flatGeometry, material);
    mesh.position.set(x, y, z);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addLights(rideHeight: number): void {
    const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xdffff8, emissive: 0x8fffe6, emissiveIntensity: 4 });
    const tailLightMaterial = new THREE.MeshStandardMaterial({ color: 0xff473d, emissive: 0xff251c, emissiveIntensity: 3 });
    for (const x of [-0.57, 0.57]) {
      this.addRoundedPart(0.4, 0.1, 0.075, 0.025, headlightMaterial, x, 0.27 + rideHeight, -1.285, -0.12, `headlight-${x}`);
      this.addRoundedPart(0.34, 0.09, 0.065, 0.022, tailLightMaterial, x, 0.3 + rideHeight, 1.305, 0.05, `tail-light-${x}`);
    }
  }

  private addRearDiffuser(carbon: THREE.Material, darkMetal: THREE.Material, rideHeight: number): void {
    this.addRoundedPart(1.5, 0.12, 0.28, 0.035, carbon, 0, -0.01 + rideHeight, 1.43, 0.08, 'rear-diffuser');
    for (const x of [-0.54, 0, 0.54]) {
      this.addRoundedPart(0.055, 0.18, 0.38, 0.015, darkMetal, x, 0.01 + rideHeight, 1.42, 0.12, `diffuser-fin-${x}`);
    }
  }

  private addSpoiler(carbon: THREE.Material, accent: THREE.Material, rideHeight: number): void {
    for (const x of [-0.48, 0.48]) {
      this.addRoundedPart(0.08, 0.35, 0.11, 0.022, carbon, x, 0.51 + rideHeight, 1.08, -0.08, `spoiler-mount-${x}`);
    }
    this.addRoundedPart(1.62, 0.1, 0.32, 0.04, accent, 0, 0.72 + rideHeight, 1.12, 0.06, 'rear-spoiler');
  }

  private createWheels(carbon: THREE.Material, darkMetal: THREE.Material, accent: THREE.Material): void {
    const tireGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.32, 20, 1, false);
    tireGeometry.rotateZ(Math.PI / 2);
    const rimGeometry = new THREE.CylinderGeometry(0.19, 0.19, 0.335, 12);
    rimGeometry.rotateZ(Math.PI / 2);
    const hubGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.35, 12);
    hubGeometry.rotateZ(Math.PI / 2);
    for (let index = 0; index < 4; index += 1) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeometry, carbon);
      const rim = new THREE.Mesh(rimGeometry, darkMetal);
      const hub = new THREE.Mesh(hubGeometry, accent);
      tire.castShadow = true;
      rim.castShadow = true;
      hub.castShadow = true;
      wheel.add(tire, rim, hub);
      wheel.name = `wheel-${index}`;
      this.wheels.push(wheel);
      this.group.add(wheel);
    }
  }

  private createBoostFlames(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    for (const x of [-0.34, 0.34]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.65, 10), material);
      flame.rotation.x = Math.PI / 2;
      flame.position.set(x, 0.02, 1.76);
      flame.name = `boost-flame-${this.boostFlames.length}`;
      this.boostFlames.push(flame);
      this.group.add(flame);
    }
  }
}
