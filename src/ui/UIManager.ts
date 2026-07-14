import type { SimulationSnapshot } from '../gameplay/simulation/SimulationSnapshot';
import type { SettingsHandlers } from './menus/SettingsMenu';
import { SettingsMenu } from './menus/SettingsMenu';
import { PauseMenu } from './menus/PauseMenu';

export class UIManager {
  private readonly hud: HTMLElement;
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly boostFill: HTMLElement;
  private readonly boostValue: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly announcement: HTMLElement;
  private readonly cameraMode: HTMLElement;
  private readonly pauseMenu: PauseMenu;
  private readonly settingsMenu: SettingsMenu;

  constructor(private readonly root: HTMLElement, settings: SettingsHandlers) {
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
          <aside class="controls-hint">
            <span><b>WASD</b> DRIVE / AIR</span><span><b>RMB</b> JUMP + FLIP</span>
            <span><b>LMB</b> BOOST</span><span><b>SHIFT</b> SLIDE</span>
            <span><b>Q E</b> AIR ROLL</span><span><b>SPACE</b> BALL CAM</span>
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
              <p>Press <kbd>ESC</kbd> to return to the pitch</p>
            </div>
          </section>
          <section class="modal settings-menu" data-settings hidden>
            <div class="modal-card settings-card">
              <p class="eyebrow">TUNING BAY</p>
              <h1>SETTINGS</h1>
              ${this.range('Camera distance', 'camera-distance', 6, 13, 0.1, 8.8)}
              ${this.range('Field of view', 'field-of-view', 60, 95, 1, 72)}
              ${this.range('Bloom', 'bloom', 0, 1.2, 0.05, 0.48)}
              ${this.range('Volume', 'volume', 0, 1, 0.05, 0.55)}
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
    this.pauseMenu = new PauseMenu(root);
    this.settingsMenu = new SettingsMenu(root, settings);
  }

  renderContainer(): HTMLElement { return this.hud; }

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

    if (match.phase === 'goalExplosion') this.announcement.textContent = 'GOAL // IMPACT WAVE';
    else if (match.phase === 'replay') {
      const progress = Math.round(match.replayProgress * 100);
      this.announcement.textContent = `GOAL REPLAY // ${progress}% // RMB TO SKIP`;
    }
    else if (match.phase === 'overtime') this.announcement.textContent = 'OVERTIME // NEXT GOAL WINS';
    else if (match.phase === 'ended') this.announcement.textContent = 'MATCH COMPLETE';
    else this.announcement.textContent = '';
  }

  dispose(): void { this.root.replaceChildren(); }

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
}
