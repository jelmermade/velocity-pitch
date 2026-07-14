import * as THREE from 'three';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';

const LINE_HEIGHT = 0.032;
const LINE_WIDTH = 0.22;
const PITCH_HALF_WIDTH = ARENA_TUNING.halfWidth - 3;
const PITCH_HALF_LENGTH = ARENA_TUNING.halfLength - 4.5;
const CENTER_CIRCLE_RADIUS = ARENA_TUNING.halfWidth * 0.18;

export class GrassFieldView {
  readonly group = new THREE.Group();
  private readonly lineMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4f3df,
    roughness: 0.72,
    metalness: 0,
  });

  constructor() {
    this.group.name = 'grass-field';
    this.addTurf();
    this.addMarkings();
  }

  private addTurf(): void {
    const texture = createGrassTexture();
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0,
    });
    const turf = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_TUNING.halfWidth * 2, ARENA_TUNING.halfLength * 2),
      material,
    );
    turf.name = 'turf';
    turf.rotation.x = -Math.PI / 2;
    turf.position.y = 0.006;
    turf.receiveShadow = true;
    this.group.add(turf);
  }

  private addMarkings(): void {
    this.addLine(0, -PITCH_HALF_LENGTH, PITCH_HALF_WIDTH * 2, LINE_WIDTH);
    this.addLine(0, PITCH_HALF_LENGTH, PITCH_HALF_WIDTH * 2, LINE_WIDTH);
    this.addLine(-PITCH_HALF_WIDTH, 0, LINE_WIDTH, PITCH_HALF_LENGTH * 2);
    this.addLine(PITCH_HALF_WIDTH, 0, LINE_WIDTH, PITCH_HALF_LENGTH * 2);
    this.addLine(0, 0, PITCH_HALF_WIDTH * 2, LINE_WIDTH);

    const centerCircle = new THREE.Mesh(
      new THREE.RingGeometry(CENTER_CIRCLE_RADIUS - LINE_WIDTH, CENTER_CIRCLE_RADIUS, 72),
      this.lineMaterial,
    );
    centerCircle.name = 'center-circle';
    centerCircle.rotation.x = -Math.PI / 2;
    centerCircle.position.y = LINE_HEIGHT + 0.006;
    this.group.add(centerCircle);

    this.addSpot(0, 0, 0.24);
    for (const zSign of [-1, 1] as const) {
      this.addPenaltyArea(zSign, ARENA_TUNING.halfWidth * 0.41, ARENA_TUNING.halfLength * 0.196);
      this.addPenaltyArea(zSign, ARENA_TUNING.halfWidth * 0.206, ARENA_TUNING.halfLength * 0.098);
      this.addSpot(0, zSign * (PITCH_HALF_LENGTH - ARENA_TUNING.halfLength * 0.16), 0.2);
    }
  }

  private addPenaltyArea(zSign: -1 | 1, halfWidth: number, depth: number): void {
    const goalLineZ = zSign * PITCH_HALF_LENGTH;
    const frontZ = zSign * (PITCH_HALF_LENGTH - depth);
    this.addLine(0, frontZ, halfWidth * 2, LINE_WIDTH);
    this.addLine(-halfWidth, (goalLineZ + frontZ) / 2, LINE_WIDTH, depth);
    this.addLine(halfWidth, (goalLineZ + frontZ) / 2, LINE_WIDTH, depth);
  }

  private addLine(x: number, z: number, width: number, depth: number): void {
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, LINE_HEIGHT, depth), this.lineMaterial);
    line.position.set(x, LINE_HEIGHT / 2 + 0.012, z);
    line.receiveShadow = true;
    this.group.add(line);
  }

  private addSpot(x: number, z: number, radius: number): void {
    const spot = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), this.lineMaterial);
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(x, LINE_HEIGHT + 0.009, z);
    this.group.add(spot);
  }
}

const createGrassTexture = (): THREE.DataTexture => {
  const width = 256;
  const height = 384;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const stripe = Math.floor(y / (height / 12)) % 2;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const grain = hash(x, y) * 13 - 6;
      data[index] = 30 + stripe * 5 + grain;
      data[index + 1] = 91 + stripe * 13 + grain;
      data[index + 2] = 49 + stripe * 6 + grain * 0.5;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.name = 'procedural-grass';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const hash = (x: number, y: number): number => {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};
