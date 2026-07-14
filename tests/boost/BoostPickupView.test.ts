import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BoostPickupView } from '../../src/rendering/views/BoostPickupView';

describe('BoostPickupView', () => {
  it('uses restrained emissive levels so pickup bloom does not obscure the field', () => {
    const view = new BoostPickupView();
    const emissiveIntensities: number[] = [];

    view.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          emissiveIntensities.push(material.emissiveIntensity);
        }
      });
    });

    expect(Math.max(...emissiveIntensities)).toBeLessThanOrEqual(1.8);
    view.dispose();
  });
});
