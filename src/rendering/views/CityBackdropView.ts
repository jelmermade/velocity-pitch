import * as THREE from 'three';
import { ARENA_TUNING } from '../../core/config/ArenaTuning';

interface BuildingDefinition {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly side: 'x' | 'z';
  readonly sign: -1 | 1;
  readonly palette: number;
}

const BUILDING_PALETTE = [0x142a33, 0x1a3540, 0x223d46] as const;

export class CityBackdropView {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'city-backdrop';
    this.addGround();
    this.addSkyline(createBuildings());
  }

  private addGround(): void {
    const groundSize = Math.max(280, (ARENA_TUNING.halfLength + 55) * 2);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshStandardMaterial({ color: 0x071216, roughness: 0.96, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private addSkyline(buildings: readonly BuildingDefinition[]): void {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    BUILDING_PALETTE.forEach((color, palette) => {
      const definitions = buildings.filter((building) => building.palette === palette);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.12,
        roughness: 0.62,
        metalness: 0.25,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, definitions.length);
      mesh.name = `city-buildings-${palette}`;
      const transform = new THREE.Object3D();
      definitions.forEach((building, index) => {
        transform.position.set(building.x, building.height / 2, building.z);
        transform.scale.set(building.width, building.height, building.depth);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    });
    this.addWindows(buildings);
    this.addRooftopLights(buildings);
  }

  private addWindows(buildings: readonly BuildingDefinition[]): void {
    const windows = buildings.flatMap((building) => {
      const rows = Math.max(2, Math.min(8, Math.floor(building.height / 4)));
      return Array.from({ length: rows }, (_, row) => ({ building, y: 2.5 + row * 3.4 }));
    });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xf1c978, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geometry, material, windows.length);
    mesh.name = 'city-windows';
    const transform = new THREE.Object3D();
    windows.forEach(({ building, y }, index) => {
      if (building.side === 'x') {
        transform.position.set(
          building.x - building.sign * (building.width / 2 + 0.03),
          y,
          building.z,
        );
        transform.scale.set(0.08, 0.34, building.depth * 0.62);
      } else {
        transform.position.set(
          building.x,
          y,
          building.z - building.sign * (building.depth / 2 + 0.03),
        );
        transform.scale.set(building.width * 0.62, 0.34, 0.08);
      }
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private addRooftopLights(buildings: readonly BuildingDefinition[]): void {
    const towers = buildings.filter((_, index) => index % 5 === 0);
    const mesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.06, 3.5, 6),
      new THREE.MeshBasicMaterial({ color: 0xff735f, toneMapped: false }),
      towers.length,
    );
    mesh.name = 'city-rooftop-lights';
    const transform = new THREE.Object3D();
    towers.forEach((building, index) => {
      transform.position.set(building.x, building.height + 1.75, building.z);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }
}

const createBuildings = (): readonly BuildingDefinition[] => {
  const buildings: BuildingDefinition[] = [];
  const sideCount = 20;
  const sideSpan = ARENA_TUNING.halfLength + 18;
  const endCount = 15;
  const endSpan = ARENA_TUNING.halfWidth + 14;
  for (const sign of [-1, 1] as const) {
    for (let index = 0; index < sideCount; index += 1) {
      buildings.push(building(
        sign * (ARENA_TUNING.halfWidth + 13 + random(index, sign) * 24),
        -sideSpan + index * (sideSpan * 2 / (sideCount - 1)) + random(index + 20, sign) * 3,
        'x',
        sign,
        index,
      ));
    }
    for (let index = 0; index < endCount; index += 1) {
      buildings.push(building(
        -endSpan + index * (endSpan * 2 / (endCount - 1)) + random(index + 40, sign) * 3,
        sign * (ARENA_TUNING.halfLength + 13 + random(index + 60, sign) * 22),
        'z',
        sign,
        index + sideCount,
      ));
    }
  }
  return buildings;
};

const building = (
  x: number,
  z: number,
  side: BuildingDefinition['side'],
  sign: -1 | 1,
  seed: number,
): BuildingDefinition => ({
  x,
  z,
  width: 4.5 + random(seed + 80, sign) * 6,
  depth: 4.5 + random(seed + 100, sign) * 6,
  height: 9 + random(seed + 120, sign) * 29,
  side,
  sign,
  palette: seed % BUILDING_PALETTE.length,
});

const random = (seed: number, sign: number): number => {
  const value = Math.sin(seed * 91.17 + sign * 17.31) * 47_123.193;
  return value - Math.floor(value);
};
