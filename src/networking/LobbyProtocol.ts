import type { CarState } from '../gameplay/car/CarState';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { PlayerCommand } from '../input/PlayerCommand';

export type TeamId = 'azure' | 'coral';

export interface LobbyPlayer {
  readonly id: string;
  readonly name: string;
  readonly team: TeamId;
  readonly host: boolean;
}

export interface AuthoritativeFrame {
  readonly sequence: number;
  readonly snapshot: SimulationSnapshot;
  readonly cars: Readonly<Record<string, CarState>>;
}

export type ClientLobbyMessage =
  | { readonly type: 'createLobby'; readonly playerName: string }
  | { readonly type: 'joinLobby'; readonly lobbyId: string; readonly playerName: string }
  | { readonly type: 'startMatch' }
  | { readonly type: 'input'; readonly sequence: number; readonly command: PlayerCommand }
  | { readonly type: 'authoritativeFrame'; readonly frame: AuthoritativeFrame };

export type ServerLobbyMessage =
  | { readonly type: 'lobbyJoined'; readonly lobbyId: string; readonly playerId: string; readonly players: readonly LobbyPlayer[] }
  | { readonly type: 'roster'; readonly players: readonly LobbyPlayer[] }
  | { readonly type: 'matchStarted'; readonly players: readonly LobbyPlayer[]; readonly hostId: string }
  | { readonly type: 'remoteInput'; readonly playerId: string; readonly sequence: number; readonly command: PlayerCommand }
  | { readonly type: 'authoritativeFrame'; readonly frame: AuthoritativeFrame }
  | { readonly type: 'error'; readonly message: string };
