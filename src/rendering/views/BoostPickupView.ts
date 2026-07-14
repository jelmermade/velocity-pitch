import * as THREE from 'three';
import { BOOST_PICKUP_DEFINITIONS } from '../../gameplay/boost/BoostPickup';
import type { BoostPickupState } from '../../gameplay/boost/BoostPickup';

const ACTIVE_BASE_EMISSIVE_INTENSITY = 0.14;
const INACTIVE_BASE_EMISSIVE_INTENSITY = 0.02;

interface PickupVisual {
  readonly root: THREE.Group;
  readonly energy: THREE.Group;
  readonly baseMaterial: THREE.MeshStandardMaterial;
  readonly phase: number;
  active: boolean;
}

export class BoostPickupView {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<string, PickupVisual>();
  private elapsed = 0;

  constructor() {
    BOOST_PICKUP_DEFINITIONS.forEach((definition, index) => {
      const large = definition.kind === 'large';
      const radius = large ? 1.25 : 0.72;
      const color = large ? 0xffc247 : 0x72f7b5;
      const root = new THREE.Group();
      root.position.set(definition.position.x, definition.position.y, definition.position.z);

      const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x142b30,
        emissive: color,
        emissiveIntensity: ACTIVE_BASE_EMISSIVE_INTENSITY,
        metalness: 0.62,
        roughness: 0.32,
      });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 0.09, large ? 8 : 6), baseMaterial);
      base.receiveShadow = true;
      root.add(base);

      const energy = new THREE.Group();
      const energyMaterial = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: large ? 1.8 : 1.15,
        metalness: 0.18,
        roughness: 0.15,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.78, large ? 0.1 : 0.065, 8, large ? 20 : 14), energyMaterial);
      ring.rotation.x = Math.PI / 2;
      energy.add(ring);

      const coreGeometry = large
        ? new THREE.OctahedronGeometry(0.48, 0)
        : new THREE.IcosahedronGeometry(0.22, 0);
      const core = new THREE.Mesh(coreGeometry, energyMaterial);
      core.position.y = large ? 0.7 : 0.38;
      energy.add(core);
      root.add(energy);
      this.group.add(root);
      this.visuals.set(definition.id, { root, energy, baseMaterial, phase: index * 0.61, active: true });
    });
  }

  update(states: readonly BoostPickupState[]): void {
    states.forEach((state) => {
      const visual = this.visuals.get(state.id);
      if (!visual) return;
      visual.active = state.active;
      visual.energy.visible = state.active;
      visual.baseMaterial.emissiveIntensity = state.active
        ? ACTIVE_BASE_EMISSIVE_INTENSITY
        : INACTIVE_BASE_EMISSIVE_INTENSITY;
    });
  }

  animate(deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    this.visuals.forEach((visual) => {
      if (!visual.active) return;
      visual.energy.rotation.y += deltaSeconds * 1.8;
      visual.energy.position.y = Math.sin(this.elapsed * 2.4 + visual.phase) * 0.08;
      const pulse = 1 + Math.sin(this.elapsed * 3.2 + visual.phase) * 0.06;
      visual.energy.scale.setScalar(pulse);
    });
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      const material = object.material as THREE.Material | THREE.Material[];
      geometry.dispose();
      (Array.isArray(material) ? material : [material]).forEach((entry) => entry.dispose());
    });
  }
}
