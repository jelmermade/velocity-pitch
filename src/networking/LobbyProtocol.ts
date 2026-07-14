import type { CarState } from '../gameplay/car/CarState';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { PlayerCommand } from '../input/PlayerCommand';
import type { MatchSettings } from '../gameplay/match/MatchSettings';

export type TeamId = 'azure' | 'coral';
export type MatchControlAction = 'reset' | 'stop';

export interface LobbyPlayer {
  readonly id: string;
  readonly name: string;
  readonly team: TeamId;
  readonly host: boolean;
}

export interface LobbySummary {
  readonly id: string;
  readonly hostName: string;
  readonly playerCount: number;
  readonly maximumPlayers: number;
  readonly passwordProtected: boolean;
}

export interface AuthoritativeFrame {
  readonly sequence: number;
  readonly snapshot: SimulationSnapshot;
  readonly cars: Readonly<Record<string, CarState>>;
}

export type ClientLobbyMessage =
  | { readonly type: 'listLobbies' }
  | { readonly type: 'createLobby'; readonly playerName: string; readonly settings: MatchSettings; readonly password: string }
  | { readonly type: 'joinLobby'; readonly lobbyId: string; readonly playerName: string; readonly password: string }
  | { readonly type: 'startMatch' }
  | { readonly type: 'setPlayerTeam'; readonly playerId: string; readonly team: TeamId }
  | { readonly type: 'kickPlayer'; readonly playerId: string }
  | { readonly type: 'matchControl'; readonly action: MatchControlAction }
  | { readonly type: 'finishMatch' }
  | { readonly type: 'updateMatchSettings'; readonly settings: MatchSettings }
  | { readonly type: 'input'; readonly sequence: number; readonly command: PlayerCommand }
  | { readonly type: 'authoritativeFrame'; readonly frame: AuthoritativeFrame };

export type ServerLobbyMessage =
  | { readonly type: 'lobbyList'; readonly lobbies: readonly LobbySummary[] }
  | { readonly type: 'lobbyJoined'; readonly lobbyId: string; readonly playerId: string; readonly players: readonly LobbyPlayer[]; readonly settings: MatchSettings }
  | { readonly type: 'roster'; readonly players: readonly LobbyPlayer[] }
  | { readonly type: 'matchSettings'; readonly settings: MatchSettings }
  | { readonly type: 'matchStarted'; readonly players: readonly LobbyPlayer[]; readonly hostId: string; readonly settings: MatchSettings }
  | { readonly type: 'removedFromLobby'; readonly reason: string }
  | { readonly type: 'matchControl'; readonly action: MatchControlAction }
  | { readonly type: 'returnedToLobby'; readonly players: readonly LobbyPlayer[]; readonly settings: MatchSettings }
  | { readonly type: 'remoteInput'; readonly playerId: string; readonly sequence: number; readonly command: PlayerCommand }
  | { readonly type: 'authoritativeFrame'; readonly frame: AuthoritativeFrame }
  | { readonly type: 'error'; readonly message: string };
