import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { Vec3 } from '../core/math/Vector3';
import type { LobbyPlayer, TeamId } from '../networking/LobbyProtocol';
import type { SettingsHandlers } from './menus/SettingsMenu';
import { SettingsMenu } from './menus/SettingsMenu';
import { PauseMenu } from './menus/PauseMenu';
import { ChatPanel, type ChatPanelSource } from './ChatPanel';
import type { BotTrainingState } from '../gameplay/bots/BotTrainingState';
import { BotLabTuningPanel, type BotLabTuningSource } from './BotLabTuningPanel';

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
  private readonly botLabTuning: BotLabTuningPanel | null;
  private readonly trainingGeneration: HTMLElement | null;
  private readonly trainingComplete: HTMLElement | null;
  private readonly trainingResult: HTMLElement | null;
  private readonly trainingRows = new Map<string, {
    readonly row: HTMLElement;
    readonly points: HTMLElement;
    readonly policy: HTMLElement;
    readonly reward: HTMLElement;
  }>();
  private readonly practice: boolean;
  private fpsVisible = false;
  private positionVisible = false;
  private smoothedFrameSeconds = 1 / 60;
  private fpsRefreshElapsed = 0;
  private lastTrainingTick = -1;

  constructor(
    private readonly root: HTMLElement,
    settings: Omit<SettingsHandlers, 'onShowFps' | 'onShowPosition'>,
    actions: {
      readonly players: readonly LobbyPlayer[];
      readonly localPlayerId: string;
      readonly multiplayer: boolean;
      readonly training?: boolean;
      readonly practice?: boolean;
      readonly host: boolean;
      readonly onLeave: () => void | Promise<void>;
      readonly onRestartTraining?: () => void | Promise<void>;
      readonly onResetMatch: () => void;
      readonly onStopMatch: () => void;
      readonly chat?: ChatPanelSource;
      readonly botLabTuning?: BotLabTuningSource;
    },
  ) {
    this.practice = actions.practice ?? false;
    root.innerHTML = `
      <div class="game-shell">
        <div class="render-layer" data-render-layer></div>
        <div class="ui-layer">
          <header class="scoreboard" aria-label="Match scoreboard">
            <span class="team team--azure">${actions.practice ? 'TRAINING' : 'AZURE'}</span>
            <strong class="score" data-score>${actions.practice ? '0 GOALS' : '0 <i>:</i> 0'}</strong>
            <span class="team team--coral">${actions.practice ? 'FREE PLAY' : 'CORAL'}</span>
            <time class="clock" data-clock>${actions.practice ? 'NO LIMIT' : '5:00'}</time>
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
          ${actions.training ? trainingPanelMarkup(actions.players) : ''}
          ${actions.botLabTuning ? '<div class="bot-lab-tuning-root" data-bot-lab-tuning></div>' : ''}
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
            ${actions.training
              ? '<span><b>SPACE</b> BALL CAM</span><span><b>F3</b> FREE CAM</span><span><b>TAB</b> TEAM ROSTER</span><span><b>ESC</b> PAUSE / QUIT</span>'
              : '<span><b>WASD</b> DRIVE / AIR</span><span><b>RMB</b> JUMP + FLIP</span><span><b>LMB</b> BOOST</span><span><b>SHIFT</b> SLIDE</span><span><b>Q E</b> AIR ROLL</span><span><b>SPACE</b> BALL CAM</span><span><b>TAB</b> SCORE + PLAYERS</span>'}
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
              <button class="leave-match" type="button" data-leave-match>${actions.multiplayer ? 'LEAVE LOBBY' : actions.practice ? 'LEAVE TRAINING' : 'LEAVE MATCH'}</button>
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
          ${actions.training ? trainingCompletionMarkup() : ''}
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
    this.botLabTuning = actions.botLabTuning
      ? new BotLabTuningPanel(this.require('[data-bot-lab-tuning]'), actions.botLabTuning)
      : null;
    this.trainingGeneration = this.root.querySelector('[data-training-generation]');
    this.trainingComplete = this.root.querySelector('[data-training-complete]');
    this.trainingResult = this.root.querySelector('[data-training-result]');
    this.root.querySelectorAll<HTMLElement>('[data-training-player]').forEach((row) => {
      const playerId = row.dataset.trainingPlayer;
      const points = row.querySelector<HTMLElement>('[data-training-points]');
      const policy = row.querySelector<HTMLElement>('[data-training-policy]');
      const reward = row.querySelector<HTMLElement>('[data-training-reward]');
      if (playerId && points && policy && reward) this.trainingRows.set(playerId, { row, points, policy, reward });
    });
    this.root.querySelector('[data-training-restart]')?.addEventListener('click', () => {
      void this.runTrainingAction(actions.onRestartTraining, 'SAVING KNOWLEDGE // STARTING NEXT CYCLE');
    });
    this.root.querySelector('[data-training-menu]')?.addEventListener('click', () => {
      void this.runTrainingAction(actions.onLeave, 'SAVING KNOWLEDGE // RETURNING TO MENU');
    });
    this.setFpsVisible(this.loadFpsPreference());
    this.setPositionVisible(this.loadPositionPreference());
  }

  renderContainer(): HTMLElement { return this.hud; }

  toggleFpsCounter(): void { this.setFpsVisible(!this.fpsVisible); }

  setPlayerScoreboardVisible(visible: boolean): void {
    this.playerScoreboard.hidden = !visible;
  }

  updateTraining(state?: BotTrainingState, spectatedPlayerId: string | null = null): void {
    if (!state || state.tick - this.lastTrainingTick < 15) return;
    this.lastTrainingTick = state.tick;
    if (this.trainingGeneration) this.trainingGeneration.textContent = `PERSISTENT // GEN ${state.knowledgeGeneration}`;
    state.entries.forEach((entry) => {
      const row = this.trainingRows.get(entry.playerId);
      if (!row) return;
      row.row.classList.toggle('bot-training-row--spectated', entry.playerId === spectatedPlayerId);
      row.points.textContent = entry.points.toFixed(1);
      row.policy.textContent = entry.policy.toUpperCase();
      row.reward.textContent = entry.lastReward > 0 ? `+${entry.lastReward.toFixed(2)}` : entry.lastReward.toFixed(2);
      row.reward.classList.toggle('bot-training-row__reward--positive', entry.lastReward > 0);
      row.reward.classList.toggle('bot-training-row__reward--negative', entry.lastReward < 0);
    });
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
    this.score.innerHTML = this.practice
      ? `${match.azureScore} ${match.azureScore === 1 ? 'GOAL' : 'GOALS'}`
      : `${match.azureScore} <i>:</i> ${match.coralScore}`;
    this.playerScoreboardAzure.textContent = match.azureScore.toString();
    this.playerScoreboardCoral.textContent = match.coralScore.toString();
    this.clock.textContent = this.practice ? 'NO LIMIT' : match.overtime ? 'OT' : this.formatTime(match.timeRemaining);
    this.boostValue.textContent = Math.round(car.boost).toString();
    this.boostFill.style.transform = `scaleX(${car.boost / 100})`;
    this.countdown.textContent = match.countdown > 0 ? match.countdown.toString() : '';
    this.cameraMode.textContent = cameraMode.toUpperCase();
    this.pauseMenu.setVisible(match.paused);
    if (!match.paused) this.settingsMenu.hide();

    if (this.trainingComplete) this.trainingComplete.hidden = match.phase !== 'ended';
    if (this.trainingResult && match.phase === 'ended') {
      this.trainingResult.textContent = this.matchResult(match.azureScore, match.coralScore);
    }

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
    this.botLabTuning?.dispose();
    this.root.replaceChildren();
  }

  private async runTrainingAction(
    action: (() => void | Promise<void>) | undefined,
    pendingMessage: string,
  ): Promise<void> {
    if (!action) return;
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('[data-training-complete] button');
    const status = this.root.querySelector<HTMLElement>('[data-training-action-status]');
    buttons.forEach((button) => { button.disabled = true; });
    if (status) status.textContent = pendingMessage;
    try {
      await action();
    } catch {
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = 'KNOWLEDGE SAVE FAILED // TRY AGAIN';
    }
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

export const trainingCompletionMarkup = (): string => `
  <section class="modal training-complete" data-training-complete hidden aria-label="Bot Lab complete">
    <div class="modal-card training-complete__card">
      <p class="eyebrow">LEARNING CYCLE COMPLETE</p>
      <h1 data-training-result>MATCH COMPLETE</h1>
      <p class="training-complete__summary">The latest bot observations are ready to be merged into shared knowledge.</p>
      <div class="training-complete__actions">
        <button type="button" data-training-restart>RUN ANOTHER 5 MINUTES</button>
        <button class="leave-match" type="button" data-training-menu>BACK TO MENU</button>
      </div>
      <p class="training-complete__status" data-training-action-status aria-live="polite">CHOOSE THE NEXT TEST CYCLE</p>
    </div>
  </section>`;

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

const trainingPanelMarkup = (players: readonly LobbyPlayer[]): string => `
  <aside class="bot-training-panel" aria-label="Bot learning scores">
    <header><b>BOT LAB // LIVE LEARNING</b><span data-training-generation>PERSISTENT // GEN 0</span></header>
    <div class="bot-training-panel__teams">
      ${(['azure', 'coral'] as const).map((team) => `
        <section class="bot-training-panel__team bot-training-panel__team--${team}">
          <h2>${team.toUpperCase()}</h2>
          ${players.filter((player) => player.team === team).map((player) => `
            <div class="bot-training-row" data-training-player="${escapeHtml(player.id)}">
              <b>${escapeHtml(player.name.replace(' [BOT]', ''))}</b>
              <strong data-training-points>0.0</strong>
              <small data-training-policy>BALANCED</small>
              <i data-training-reward>0.00</i>
            </div>`).join('')}
        </section>`).join('')}
    </div>
    <p class="bot-training-panel__debug-legend" data-bot-debug-legend>
      <span>TEAM ARROWS // BOT TARGETS</span><span>OUTLINES // HITBOX GUIDES</span><span>BALL DASH // 3 SEC PATH</span>
    </p>
  </aside>`;
