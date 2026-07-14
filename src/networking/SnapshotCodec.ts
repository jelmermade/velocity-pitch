import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';

export class SnapshotCodec {
  encode(snapshot: SimulationSnapshot): string {
    return JSON.stringify(snapshot);
  }

  decode(payload: string): SimulationSnapshot {
    return JSON.parse(payload) as SimulationSnapshot;
  }
}
