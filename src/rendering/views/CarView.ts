import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CarState } from '../../gameplay/car/CarState';
import { WHEEL_CONNECTIONS } from '../../gameplay/car/WheelState';
import type { TeamId } from '../../networking/LobbyProtocol';

export class CarView {
  readonly group = new THREE.Group();
  private readonly wheels: THREE.Group[] = [];
  private readonly boostFlames: THREE.Mesh[] = [];
  private animationSeconds = 0;

  constructor(team: TeamId = 'azure') {
    const bodyColor = team === 'azure' ? 0x12afbd : 0xd94e47;
    const highlightColor = team === 'azure' ? 0x67e2df : 0xff8b80;
    const body = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.72, roughness: 0.22 });
    const bodyHighlight = new THREE.MeshStandardMaterial({ color: highlightColor, metalness: 0.58, roughness: 0.2 });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x071116, metalness: 0.5, roughness: 0.22 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0b2e39,
      metalness: 0.35,
      roughness: 0.16,
    });

    this.addRoundedPart(1.84, 0.72, 2.72, 0.18, body, 0, 0, 0);
    this.addRoundedPart(1.74, 0.3, 2.98, 0.1, carbon, 0, -0.27, 0.03);
    this.addRoundedPart(1.68, 0.28, 0.95, 0.1, bodyHighlight, 0, 0.22, -1.02, -0.18);
    this.addRoundedPart(1.94, 0.22, 0.28, 0.09, carbon, 0, -0.17, -1.46);
    this.addRoundedPart(1.38, 0.58, 1.13, 0.16, glass, 0, 0.53, 0.08, -0.04);
    this.addRoundedPart(1.12, 0.13, 0.72, 0.06, carbon, 0, 0.84, 0.16);

    for (const x of [-0.82, 0.82]) {
      for (const z of [-0.92, 0.92]) {
        this.addRoundedPart(0.38, 0.34, 0.82, 0.1, body, x, 0.03, z);
      }
      this.addRoundedPart(0.18, 0.2, 1.82, 0.07, carbon, x * 1.08, -0.18, 0.03);
    }

    this.addLights();
    this.addSpoiler(carbon, bodyHighlight);
    this.createWheels(carbon);
    this.createBoostFlames();
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
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const collect = (object: THREE.Object3D): void => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry as THREE.BufferGeometry);
      const material = object.material as THREE.Material | THREE.Material[];
      (Array.isArray(material) ? material : [material]).forEach((entry) => materials.add(entry));
    };
    this.group.traverse(collect);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
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
  ): void {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 4, radius), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = pitch;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addLights(): void {
    const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xdffff8, emissive: 0x8fffe6, emissiveIntensity: 4 });
    const tailLightMaterial = new THREE.MeshStandardMaterial({ color: 0xff473d, emissive: 0xff251c, emissiveIntensity: 3 });
    for (const x of [-0.57, 0.57]) {
      this.addRoundedPart(0.38, 0.14, 0.08, 0.035, headlightMaterial, x, 0.12, -1.405, -0.08);
      this.addRoundedPart(0.32, 0.12, 0.07, 0.03, tailLightMaterial, x, 0.08, 1.39);
    }
  }

  private addSpoiler(carbon: THREE.Material, accent: THREE.Material): void {
    for (const x of [-0.48, 0.48]) this.addRoundedPart(0.09, 0.38, 0.1, 0.025, carbon, x, 0.42, 1.12);
    this.addRoundedPart(1.58, 0.11, 0.34, 0.05, accent, 0, 0.63, 1.15, 0.07);
  }

  private createWheels(carbon: THREE.Material): void {
    const tireGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.32, 16, 1, false);
    tireGeometry.rotateZ(Math.PI / 2);
    const rimGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.33, 10);
    rimGeometry.rotateZ(Math.PI / 2);
    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xb8ff66, emissive: 0x385d19, emissiveIntensity: 0.55, metalness: 0.82, roughness: 0.18 });
    for (let index = 0; index < 4; index += 1) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(tireGeometry, carbon);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      tire.castShadow = true;
      rim.castShadow = true;
      wheel.add(tire, rim);
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
      flame.position.set(x, -0.12, 1.76);
      flame.name = `boost-flame-${this.boostFlames.length}`;
      this.boostFlames.push(flame);
      this.group.add(flame);
    }
  }
}
