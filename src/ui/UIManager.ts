import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { Vec3 } from '../core/math/Vector3';
import type { LobbyPlayer, TeamId } from '../networking/LobbyProtocol';
import type { SettingsHandlers } from './menus/SettingsMenu';
import { SettingsMenu } from './menus/SettingsMenu';
import { PauseMenu } from './menus/PauseMenu';
import { ChatPanel, type ChatPanelSource } from './ChatPanel';

const FPS_STORAGE_KEY = 'velocity-pitch:show-fps';
const POSITION_STORAGE_KEY = 'velocity-pitch:show-position';

export class UIManager {
  private readonly hud: HTMLElement;
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly boostFill: HTMLElement;
  private readonly boostValue: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly announcement: HTMLElement;
  private readonly cameraMode: HTMLElement;
  private readonly fpsCounter: HTMLElement;
  private readonly fpsValue: HTMLElement;
  private readonly positionCounter: HTMLElement;
  private readonly carPosition: HTMLElement;
  private readonly playerScoreboard: HTMLElement;
  private readonly playerScoreboardAzure: HTMLElement;
  private readonly playerScoreboardCoral: HTMLElement;
  private readonly pauseMenu: PauseMenu;
  private readonly settingsMenu: SettingsMenu;
  private readonly chatPanel: ChatPanel | null;
  private fpsVisible = false;
  private positionVisible = false;
  private smoothedFrameSeconds = 1 / 60;
  private fpsRefreshElapsed = 0;

  constructor(
    private readonly root: HTMLElement,
    settings: Omit<SettingsHandlers, 'onShowFps' | 'onShowPosition'>,
    actions: {
      readonly players: readonly LobbyPlayer[];
      readonly localPlayerId: string;
      readonly multiplayer: boolean;
      readonly host: boolean;
      readonly onLeave: () => void;
      readonly onResetMatch: () => void;
      readonly onStopMatch: () => void;
      readonly chat?: ChatPanelSource;
    },
  ) {
    root.innerHTML = `
      <div class="game-shell">
        <div class="render-layer" data-render-layer></div>
        <div class="ui-layer">
          <header class="scoreboard" aria-label="Match scoreboard">
            <span class="team team--azure">AZURE</span>
            <strong class="score" data-score>0 <i>:</i> 0</strong>
            <span class="team team--coral">CORAL</span>
            <time class="clock" data-clock>5:00</time>
          </header>
          <section class="announcement" data-announcement></section>
          <div class="countdown" data-countdown></div>
          <div class="match-hud-stack">
            ${actions.chat ? '<div class="match-chat" data-chat-panel></div>' : ''}
            <div class="debug-readout">
              <aside class="fps-counter" data-fps-counter hidden>FPS <b data-fps-value>60</b></aside>
              <aside class="position-counter" data-position-counter hidden>POS <b data-car-position>X 0.00 Y 0.00 Z 0.00</b></aside>
            </div>
          </div>
          <aside class="camera-tag">CAM <b data-camera-mode>BALL</b></aside>
          <section class="player-scoreboard" data-player-scoreboard hidden aria-label="Match score and players">
            <p class="eyebrow">LIVE MATCH // HOLD TAB</p>
            <header class="player-scoreboard__score">
              <span class="player-scoreboard__azure">AZURE <b data-player-score-azure>0</b></span>
              <i>:</i>
              <span class="player-scoreboard__coral"><b data-player-score-coral>0</b> CORAL</span>
            </header>
            <div class="player-scoreboard__teams">
              <article class="player-scoreboard__team player-scoreboard__team--azure">
                <h2>AZURE DRIVERS</h2>
                ${playerRosterMarkup(actions.players, 'azure', actions.localPlayerId)}
              </article>
              <article class="player-scoreboard__team player-scoreboard__team--coral">
                <h2>CORAL DRIVERS</h2>
                ${playerRosterMarkup(actions.players, 'coral', actions.localPlayerId)}
              </article>
            </div>
          </section>
          <aside class="controls-hint">
            <span><b>WASD</b> DRIVE / AIR</span><span><b>RMB</b> JUMP + FLIP</span>
            <span><b>LMB</b> BOOST</span><span><b>SHIFT</b> SLIDE</span>
            <span><b>Q E</b> AIR ROLL</span><span><b>SPACE</b> BALL CAM</span>
            <span><b>TAB</b> SCORE + PLAYERS</span>
            ${actions.chat ? '<span><b>ENTER</b> ALL CHAT</span><span><b>T</b> TEAM CHAT</span><span><b>Y</b> PARTY CHAT</span>' : ''}
          </aside>
          <div class="boost-gauge" aria-label="Boost">
            <span class="boost-label">BOOST</span>
            <strong data-boost-value>100</strong>
            <div class="boost-track"><i data-boost-fill></i></div>
          </div>
          <section class="modal pause-menu" data-pause-menu hidden>
            <div class="modal-card">
              <p class="eyebrow">MATCH SUSPENDED</p>
              <h1>PAUSED</h1>
              <button type="button" data-open-settings>SETTINGS</button>
              ${actions.host ? '<button type="button" data-reset-match>RESET MATCH</button>' : ''}
              ${actions.host ? '<button class="stop-match" type="button" data-stop-match>STOP MATCH</button>' : ''}
              <button class="leave-match" type="button" data-leave-match>${actions.multiplayer ? 'LEAVE LOBBY' : 'LEAVE MATCH'}</button>
              <p>Press <kbd>ESC</kbd> to return to the pitch</p>
            </div>
          </section>
          <section class="modal settings-menu" data-settings hidden>
            <div class="modal-card settings-card">
              <p class="eyebrow">TUNING BAY</p>
              <h1>SETTINGS</h1>
              ${this.range('Camera distance', 'camera-distance', 6, 13, 0.1, 8.8)}
              ${this.range('Field of view', 'field-of-view', 60, 95, 1, 72)}
              ${this.range('Bloom', 'bloom', 0, 1.2, 0.05, 0)}
              ${this.range('Volume', 'volume', 0, 1, 0.05, 0.55)}
              <label class="setting-toggle"><span>Show FPS <small>F2</small></span><input name="show-fps" type="checkbox"></label>
              <label class="setting-toggle"><span>Show car position</span><input name="show-position" type="checkbox"></label>
              <button type="button" data-close-settings>BACK</button>
            </div>
          </section>
        </div>
      </div>`;
    this.hud = this.require('[data-render-layer]');
    this.score = this.require('[data-score]');
    this.clock = this.require('[data-clock]');
    this.boostFill = this.require('[data-boost-fill]');
    this.boostValue = this.require('[data-boost-value]');
    this.countdown = this.require('[data-countdown]');
    this.announcement = this.require('[data-announcement]');
    this.cameraMode = this.require('[data-camera-mode]');
    this.fpsCounter = this.require('[data-fps-counter]');
    this.fpsValue = this.require('[data-fps-value]');
    this.positionCounter = this.require('[data-position-counter]');
    this.carPosition = this.require('[data-car-position]');
    this.playerScoreboard = this.require('[data-player-scoreboard]');
    this.playerScoreboardAzure = this.require('[data-player-score-azure]');
    this.playerScoreboardCoral = this.require('[data-player-score-coral]');
    this.pauseMenu = new PauseMenu(root, actions);
    this.settingsMenu = new SettingsMenu(root, {
      ...settings,
      onShowFps: (visible) => this.setFpsVisible(visible),
      onShowPosition: (visible) => this.setPositionVisible(visible),
    });
    this.chatPanel = actions.chat
      ? new ChatPanel(this.require('[data-chat-panel]'), actions.chat, { mode: 'match' })
      : null;
    this.setFpsVisible(this.loadFpsPreference());
    this.setPositionVisible(this.loadPositionPreference());
  }

  renderContainer(): HTMLElement { return this.hud; }

  toggleFpsCounter(): void { this.setFpsVisible(!this.fpsVisible); }

  setPlayerScoreboardVisible(visible: boolean): void {
    this.playerScoreboard.hidden = !visible;
  }

  updateFrameRate(deltaSeconds: number, position: Vec3): void {
    if ((!this.fpsVisible && !this.positionVisible) || deltaSeconds <= 0) return;
    if (this.fpsVisible) {
      const blend = 1 - Math.exp(-deltaSeconds * 5);
      this.smoothedFrameSeconds += (deltaSeconds - this.smoothedFrameSeconds) * blend;
    }
    this.fpsRefreshElapsed += deltaSeconds;
    if (this.fpsRefreshElapsed < 0.25) return;
    this.fpsRefreshElapsed = 0;
    if (this.fpsVisible) this.fpsValue.textContent = Math.round(1 / this.smoothedFrameSeconds).toString();
    if (this.positionVisible) this.carPosition.textContent = formatCarPosition(position);
  }

  update(snapshot: SimulationSnapshot, cameraMode: string): void {
    const { match, car } = snapshot;
    this.score.innerHTML = `${match.azureScore} <i>:</i> ${match.coralScore}`;
    this.playerScoreboardAzure.textContent = match.azureScore.toString();
    this.playerScoreboardCoral.textContent = match.coralScore.toString();
    this.clock.textContent = match.overtime ? 'OT' : this.formatTime(match.timeRemaining);
    this.boostValue.textContent = Math.round(car.boost).toString();
    this.boostFill.style.transform = `scaleX(${car.boost / 100})`;
    this.countdown.textContent = match.countdown > 0 ? match.countdown.toString() : '';
    this.cameraMode.textContent = cameraMode.toUpperCase();
    this.pauseMenu.setVisible(match.paused);
    if (!match.paused) this.settingsMenu.hide();

    const scoringTeam = match.lastGoalTeam?.toUpperCase() ?? 'TEAM';
    if (match.phase === 'goalExplosion') this.announcement.textContent = `${scoringTeam} SCORES // IMPACT WAVE`;
    else if (match.phase === 'replay') this.announcement.textContent = `${scoringTeam} GOAL REPLAY // RMB TO SKIP`;
    else if (match.phase === 'overtime') this.announcement.textContent = 'OVERTIME // NEXT GOAL WINS';
    else if (match.phase === 'ended') this.announcement.textContent = this.matchResult(
      match.azureScore,
      match.coralScore,
    );
    else this.announcement.textContent = '';
  }

  dispose(): void {
    this.chatPanel?.dispose();
    this.root.replaceChildren();
  }

  private setFpsVisible(visible: boolean): void {
    this.fpsVisible = visible;
    this.fpsCounter.hidden = !visible;
    this.settingsMenu.setShowFps(visible);
    try {
      window.localStorage.setItem(FPS_STORAGE_KEY, visible.toString());
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  private setPositionVisible(visible: boolean): void {
    this.positionVisible = visible;
    this.positionCounter.hidden = !visible;
    this.settingsMenu.setShowPosition(visible);
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, visible.toString());
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  private loadFpsPreference(): boolean {
    try {
      return window.localStorage.getItem(FPS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private loadPositionPreference(): boolean {
    try {
      return window.localStorage.getItem(POSITION_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private range(label: string, name: string, min: number, max: number, step: number, value: number): string {
    return `<label><span>${label}<output data-output="${name}">${value}</output></span><input name="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
  }

  private require(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`UI element ${selector} is missing`);
    return element;
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.ceil(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  private matchResult(azureScore: number, coralScore: number): string {
    if (azureScore === coralScore) return `DRAW // ${azureScore} GOALS EACH`;
    const winner = azureScore > coralScore ? 'AZURE' : 'CORAL';
    const goals = Math.max(azureScore, coralScore);
    return `${winner} WINS // ${goals} ${goals === 1 ? 'GOAL' : 'GOALS'}`;
  }
}

export const formatCarPosition = ({ x, y, z }: Vec3): string => (
  `X ${formatCoordinate(x)} Y ${formatCoordinate(y)} Z ${formatCoordinate(z)}`
);

const formatCoordinate = (value: number): string => (
  (Math.abs(value) < 0.005 ? 0 : value).toFixed(2)
);

export const playerRosterMarkup = (
  players: readonly LobbyPlayer[],
  team: TeamId,
  localPlayerId: string,
): string => {
  const teamPlayers = players.filter((player) => player.team === team);
  if (teamPlayers.length === 0) return '<p class="player-scoreboard__empty">NO DRIVERS</p>';
  return teamPlayers.map((player) => {
    const markers = [player.host ? 'HOST' : '', player.bot ? 'BOT' : '', player.id === localPlayerId ? 'YOU' : '']
      .filter(Boolean)
      .join(' // ');
    return `<div class="player-scoreboard__player"><span>${escapeHtml(player.name)}</span><small>${markers}</small></div>`;
  }).join('');
};

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character] ?? character);
