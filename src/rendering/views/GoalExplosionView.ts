import * as THREE from 'three';
import { MATCH_TUNING } from '../../core/config/MatchTuning';
import type { EventBus } from '../../core/events/EventBus';
import type { GameEventMap } from '../../core/events/GameEvents';

const PARTICLE_COUNT = 360;
const EFFECT_DURATION = MATCH_TUNING.goalExplosionSeconds;

export class GoalExplosionView {
  readonly group = new THREE.Group();
  private readonly positions = new Float32Array(PARTICLE_COUNT * 3);
  private readonly velocities = new Float32Array(PARTICLE_COUNT * 3);
  private readonly lifetimes = new Float32Array(PARTICLE_COUNT);
  private readonly particles: THREE.Points;
  private readonly particleMaterial: THREE.PointsMaterial;
  private readonly shockwave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly flash = new THREE.PointLight(0xffffff, 0, 28, 2);
  private readonly unsubscribe: () => void;
  private elapsed: number = EFFECT_DURATION;

  constructor(events: EventBus<GameEventMap>) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.34,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geometry, this.particleMaterial);
    this.particles.frustumCulled = false;

    const shockwaveMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shockwave = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), shockwaveMaterial);
    this.group.add(this.particles, this.shockwave, this.flash);
    this.group.visible = false;
    this.unsubscribe = events.on('goal', ({ team, position }) => this.trigger(team, position));
  }

  update(deltaSeconds: number): void {
    if (this.elapsed >= EFFECT_DURATION) return;
    this.elapsed = Math.min(EFFECT_DURATION, this.elapsed + deltaSeconds);
    const drag = Math.exp(-0.75 * deltaSeconds);
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3;
      if (this.elapsed >= (this.lifetimes[index] ?? 0)) {
        this.positions[offset + 1] = -1_000;
        continue;
      }
      const velocityX = (this.velocities[offset] ?? 0) * drag;
      const velocityY = (this.velocities[offset + 1] ?? 0) * drag - 10 * deltaSeconds;
      const velocityZ = (this.velocities[offset + 2] ?? 0) * drag;
      this.velocities[offset] = velocityX;
      this.velocities[offset + 1] = velocityY;
      this.velocities[offset + 2] = velocityZ;
      this.positions[offset] = (this.positions[offset] ?? 0) + velocityX * deltaSeconds;
      this.positions[offset + 1] = (this.positions[offset + 1] ?? 0) + velocityY * deltaSeconds;
      this.positions[offset + 2] = (this.positions[offset + 2] ?? 0) + velocityZ * deltaSeconds;
    }
    const positionAttribute = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
    this.particleMaterial.opacity = Math.max(0, 1 - this.elapsed / EFFECT_DURATION);
    const shockProgress = Math.min(1, this.elapsed / 0.72);
    this.shockwave.scale.setScalar(0.5 + shockProgress * 8);
    this.shockwave.material.opacity = (1 - shockProgress) * 0.75;
    this.flash.intensity = 90 * Math.exp(-8 * this.elapsed);
    if (this.elapsed >= EFFECT_DURATION) this.group.visible = false;
  }

  dispose(): void {
    this.unsubscribe();
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
    this.shockwave.geometry.dispose();
    this.shockwave.material.dispose();
  }

  private trigger(team: 'azure' | 'coral', position: { readonly x: number; readonly y: number; readonly z: number }): void {
    const color = new THREE.Color(team === 'azure' ? 0x2cd9ff : 0xff685d);
    const inward = team === 'azure' ? -1 : 1;
    this.elapsed = 0;
    this.group.visible = true;
    this.particleMaterial.color.copy(color);
    this.shockwave.material.color.copy(color);
    this.flash.color.copy(color);
    this.shockwave.scale.setScalar(0.5);
    this.group.position.set(position.x, position.y, position.z + inward * 0.45);

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3;
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = 4 + Math.random() * 15;
      this.positions[offset] = (Math.random() - 0.5) * 1.2;
      this.positions[offset + 1] = (Math.random() - 0.5) * 2.6;
      this.positions[offset + 2] = 0;
      this.velocities[offset] = Math.cos(angle) * radialSpeed;
      this.velocities[offset + 1] = Math.abs(Math.sin(angle)) * radialSpeed + 2 + Math.random() * 8;
      this.velocities[offset + 2] = inward * (8 + Math.random() * 18);
      this.lifetimes[index] = 0.65 + Math.random() * 0.9;
    }
    const positionAttribute = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
  }
}
