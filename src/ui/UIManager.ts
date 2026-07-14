import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { Vec3 } from '../core/math/Vector3';
import type { SettingsHandlers } from './menus/SettingsMenu';
import { SettingsMenu } from './menus/SettingsMenu';
import { PauseMenu } from './menus/PauseMenu';

const FPS_STORAGE_KEY = 'velocity-pitch:show-fps';

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
  private readonly carPosition: HTMLElement;
  private readonly pauseMenu: PauseMenu;
  private readonly settingsMenu: SettingsMenu;
  private fpsVisible = false;
  private smoothedFrameSeconds = 1 / 60;
  private fpsRefreshElapsed = 0;

  constructor(
    private readonly root: HTMLElement,
    settings: Omit<SettingsHandlers, 'onShowFps'>,
    actions: {
      readonly multiplayer: boolean;
      readonly host: boolean;
      readonly onLeave: () => void;
      readonly onResetMatch: () => void;
      readonly onStopMatch: () => void;
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
          <aside class="camera-tag">CAM <b data-camera-mode>BALL</b></aside>
          <aside class="fps-counter" data-fps-counter hidden>
            <span>FPS <b data-fps-value>60</b></span>
            <span>POS <b data-car-position>X 0.00 Y 0.00 Z 0.00</b></span>
          </aside>
          <aside class="controls-hint">
            <span><b>WASD</b> DRIVE / AIR</span><span><b>RMB</b> JUMP + FLIP</span>
            <span><b>LMB</b> BOOST</span><span><b>SHIFT</b> SLIDE</span>
            <span><b>Q E</b> AIR ROLL</span><span><b>SPACE</b> BALL CAM</span>
            <span><b>F2</b> FPS</span><span><b>F3</b> FREE CAM</span>
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
    this.carPosition = this.require('[data-car-position]');
    this.pauseMenu = new PauseMenu(root, actions);
    this.settingsMenu = new SettingsMenu(root, {
      ...settings,
      onShowFps: (visible) => this.setFpsVisible(visible),
    });
    this.setFpsVisible(this.loadFpsPreference());
  }

  renderContainer(): HTMLElement { return this.hud; }

  toggleFpsCounter(): void { this.setFpsVisible(!this.fpsVisible); }

  updateFrameRate(deltaSeconds: number, position: Vec3): void {
    if (!this.fpsVisible || deltaSeconds <= 0) return;
    const blend = 1 - Math.exp(-deltaSeconds * 5);
    this.smoothedFrameSeconds += (deltaSeconds - this.smoothedFrameSeconds) * blend;
    this.fpsRefreshElapsed += deltaSeconds;
    if (this.fpsRefreshElapsed < 0.25) return;
    this.fpsRefreshElapsed = 0;
    this.fpsValue.textContent = Math.round(1 / this.smoothedFrameSeconds).toString();
    this.carPosition.textContent = formatCarPosition(position);
  }

  update(snapshot: SimulationSnapshot, cameraMode: string): void {
    const { match, car } = snapshot;
    this.score.innerHTML = `${match.azureScore} <i>:</i> ${match.coralScore}`;
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

  dispose(): void { this.root.replaceChildren(); }

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

  private loadFpsPreference(): boolean {
    try {
      return window.localStorage.getItem(FPS_STORAGE_KEY) === 'true';
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
