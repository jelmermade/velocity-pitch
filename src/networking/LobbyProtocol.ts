import type { CarState } from '../gameplay/car/CarState';
import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { PlayerCommand } from '../input/PlayerCommand';
import type { MatchSettings, TeamSize } from '../gameplay/match/MatchSettings';

export type TeamId = 'azure' | 'coral';
export type MatchControlAction = 'reset' | 'stop';
export type ChatChannel = 'global' | 'team' | 'party';
export type ChatMessageType = ChatChannel | 'system' | 'error';
export const CHAT_CHARACTER_LIMIT = 160;
export const CHAT_COOLDOWN_MS = 500;

export interface LobbyChatMessage {
  readonly id: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly team?: TeamId;
  readonly channel: ChatMessageType;
  readonly text: string;
  readonly sentAt: number;
}

export interface LobbyPlayer {
  readonly id: string;
  readonly name: string;
  readonly team: TeamId;
  readonly host: boolean;
  readonly bot?: boolean;
}

export interface LobbySummary {
  readonly id: string;
  readonly name: string;
  readonly hostName: string;
  readonly playerCount: number;
  readonly maximumPlayers: number;
  readonly teamSize: TeamSize;
  readonly passwordProtected: boolean;
}

export interface AuthoritativeFrame {
  readonly sequence: number;
  readonly snapshot: SimulationSnapshot;
  readonly cars: Readonly<Record<string, CarState>>;
}

export type ClientLobbyMessage =
  | { readonly type: 'listLobbies' }
  | { readonly type: 'createLobby'; readonly playerName: string; readonly lobbyName: string; readonly settings: MatchSettings; readonly password: string }
  | { readonly type: 'joinLobby'; readonly lobbyId: string; readonly playerName: string; readonly password: string }
  | { readonly type: 'startMatch' }
  | { readonly type: 'setPlayerTeam'; readonly playerId: string; readonly team: TeamId }
  | { readonly type: 'kickPlayer'; readonly playerId: string }
  | { readonly type: 'matchControl'; readonly action: MatchControlAction }
  | { readonly type: 'finishMatch' }
  | { readonly type: 'chat'; readonly id: string; readonly channel: ChatChannel; readonly text: string }
  | { readonly type: 'updateMatchSettings'; readonly settings: MatchSettings }
  | { readonly type: 'input'; readonly sequence: number; readonly command: PlayerCommand }
  | { readonly type: 'authoritativeFrame'; readonly frame: AuthoritativeFrame };

export type ServerLobbyMessage =
  | { readonly type: 'lobbyList'; readonly lobbies: readonly LobbySummary[] }
  | { readonly type: 'lobbyJoined'; readonly lobbyId: string; readonly lobbyName: string; readonly playerId: string; readonly players: readonly LobbyPlayer[]; readonly settings: MatchSettings }
  | { readonly type: 'roster'; readonly players: readonly LobbyPlayer[] }
  | { readonly type: 'matchSettings'; readonly settings: MatchSettings }
  | { readonly type: 'matchStarted'; readonly players: readonly LobbyPlayer[]; readonly hostId: string; readonly settings: MatchSettings }
  | { readonly type: 'removedFromLobby'; readonly reason: string }
  | { readonly type: 'matchControl'; readonly action: MatchControlAction }
  | { readonly type: 'returnedToLobby'; readonly players: readonly LobbyPlayer[]; readonly settings: MatchSettings }
  | { readonly type: 'chat'; readonly message: LobbyChatMessage }
  | { readonly type: 'remoteInput'; readonly playerId: string; readonly sequence: number; readonly command: PlayerCommand }
  | { readonly type: 'authoritativeFrame'; readonly frame: AuthoritativeFrame }
  | { readonly type: 'error'; readonly message: string };
