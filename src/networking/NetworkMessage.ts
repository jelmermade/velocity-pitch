import type { PlayerCommand } from '../input/PlayerCommand';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';

export type NetworkMessage =
  | { readonly type: 'input'; readonly tick: number; readonly command: PlayerCommand }
  | { readonly type: 'snapshot'; readonly snapshot: SimulationSnapshot };
