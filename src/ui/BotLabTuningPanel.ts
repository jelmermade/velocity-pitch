import {
  GAMEPLAY_SCALE,
  sanitizeVehicleConfig,
  type GameplayConfig,
  type VehicleConfig,
} from '../core/config/GameplayScale';

export interface BotLabTuningSource {
  readonly initial: VehicleConfig;
  readonly onChange: (config: VehicleConfig) => void;
  readonly onRebuild: (config: GameplayConfig) => void | Promise<void>;
}

type ScaleConfig = Pick<GameplayConfig, 'arenaScale' | 'ballSize'>;

interface TuningField {
  readonly key: keyof VehicleConfig;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}

const FIELDS: readonly TuningField[] = [
  { key: 'driveTopSpeed', label: 'Drive top speed', minimum: 5, maximum: 50, step: 1 },
  { key: 'reverseTopSpeed', label: 'Reverse top speed', minimum: 3, maximum: 35, step: 1 },
  { key: 'accelerationMultiplier', label: 'Acceleration', minimum: 0.1, maximum: 4, step: 0.05 },
  { key: 'reverseAccelerationMultiplier', label: 'Reverse acceleration', minimum: 0.1, maximum: 4, step: 0.05 },
  { key: 'brakeMultiplier', label: 'Braking', minimum: 0.1, maximum: 4, step: 0.05 },
  { key: 'steeringMultiplier', label: 'Steering', minimum: 0.25, maximum: 2, step: 0.05 },
  { key: 'boostTopSpeed', label: 'Boost top speed', minimum: 5, maximum: 60, step: 1 },
  { key: 'boostAccelerationMultiplier', label: 'Boost acceleration', minimum: 0.1, maximum: 4, step: 0.05 },
  { key: 'boostConsumptionPerSecond', label: 'Boost consumption', minimum: 0, maximum: 100, step: 1 },
  { key: 'boostRechargePerSecond', label: 'Boost recharge', minimum: 0, maximum: 100, step: 1 },
  { key: 'jumpPowerMultiplier', label: 'Jump power', minimum: 0.25, maximum: 3, step: 0.05 },
  { key: 'dodgePowerMultiplier', label: 'Dodge power', minimum: 0.25, maximum: 3, step: 0.05 },
  { key: 'aerialControlMultiplier', label: 'Aerial control', minimum: 0.25, maximum: 3, step: 0.05 },
];

export class BotLabTuningPanel {
  private readonly panel: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly rebuildButton: HTMLButtonElement;
  private current: VehicleConfig;
  private scale: ScaleConfig = GAMEPLAY_SCALE;

  constructor(
    private readonly root: HTMLElement,
    private readonly source: BotLabTuningSource,
  ) {
    this.current = source.initial;
    root.innerHTML = botLabTuningMarkup(source.initial);
    this.panel = this.require('[data-bot-lab-tuning-panel]');
    this.textarea = this.requireTextarea('[data-bot-lab-tuning-json]');
    this.status = this.require('[data-bot-lab-tuning-status]');
    this.rebuildButton = this.requireButton('[data-bot-lab-tuning-rebuild]');
    this.require('[data-bot-lab-tuning-toggle]').addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
    });
    this.require('[data-bot-lab-tuning-close]').addEventListener('click', () => {
      this.panel.hidden = true;
    });
    this.require('[data-bot-lab-tuning-reset]').addEventListener('click', () => {
      this.apply(source.initial);
      this.setScale(GAMEPLAY_SCALE);
      this.status.textContent = 'RESET TO LOADED VALUES';
    });
    this.require('[data-bot-lab-tuning-copy]').addEventListener('click', () => {
      void this.copyJson();
    });
    root.querySelectorAll<HTMLInputElement>('[data-bot-lab-tuning-input]').forEach((input) => {
      input.addEventListener('input', () => this.apply(this.readConfig()));
    });
    root.querySelectorAll<HTMLInputElement>('[data-bot-lab-scale-input]').forEach((input) => {
      input.addEventListener('input', () => {
        this.setScale(this.readScale());
        this.status.textContent = 'SIZE CHANGED // REBUILD BOT LAB TO APPLY';
      });
    });
    this.rebuildButton.addEventListener('click', () => { void this.rebuild(); });
  }

  dispose(): void { this.root.replaceChildren(); }

  private apply(config: VehicleConfig): void {
    this.current = sanitizeVehicleConfig(config);
    FIELDS.forEach(({ key }) => {
      const input = this.requireInput(`[name="${key}"]`);
      const output = this.require(`[data-bot-lab-tuning-output="${key}"]`);
      input.value = this.current[key].toString();
      output.textContent = formatValue(this.current[key]);
    });
    this.updatePreview();
    this.status.textContent = 'LIVE // TEMPORARY VALUES APPLIED';
    this.source.onChange(this.current);
  }

  private setScale(scale: ScaleConfig): void {
    this.scale = scale;
    (['arenaScale', 'ballSize'] as const).forEach((key) => {
      const input = this.requireInput(`[name="${key}"]`);
      input.value = scale[key].toString();
      this.require(`[data-bot-lab-scale-output="${key}"]`).textContent = formatValue(scale[key]);
    });
    this.updatePreview();
  }

  private readScale(): ScaleConfig {
    return {
      arenaScale: positiveValue(this.requireInput('[name="arenaScale"]').valueAsNumber, this.scale.arenaScale),
      ballSize: positiveValue(this.requireInput('[name="ballSize"]').valueAsNumber, this.scale.ballSize),
    };
  }

  private async rebuild(): Promise<void> {
    this.rebuildButton.disabled = true;
    this.status.textContent = 'SAVING LEARNING // REBUILDING BOT LAB';
    try {
      await this.source.onRebuild({ ...this.scale, vehicle: this.current });
    } catch {
      this.rebuildButton.disabled = false;
      this.status.textContent = 'REBUILD FAILED // TRY AGAIN';
    }
  }

  private updatePreview(): void {
    this.textarea.value = gameplayConfigJson(this.current, this.scale);
  }

  private readConfig(): VehicleConfig {
    const values = Object.fromEntries(FIELDS.map(({ key }) => [
      key,
      Number(this.requireInput(`[name="${key}"]`).value),
    ]));
    return sanitizeVehicleConfig(values);
  }

  private async copyJson(): Promise<void> {
    this.textarea.focus();
    this.textarea.select();
    try {
      await navigator.clipboard.writeText(this.textarea.value);
      this.status.textContent = 'JSON COPIED // PASTE INTO gameplay-config.json';
    } catch {
      this.status.textContent = 'JSON SELECTED // COPY, THEN PASTE INTO FILE';
    }
  }

  private require(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Bot Lab tuning element ${selector} is missing`);
    return element;
  }

  private requireInput(selector: string): HTMLInputElement {
    const element = this.root.querySelector<HTMLInputElement>(selector);
    if (!element) throw new Error(`Bot Lab tuning input ${selector} is missing`);
    return element;
  }

  private requireTextarea(selector: string): HTMLTextAreaElement {
    const element = this.root.querySelector<HTMLTextAreaElement>(selector);
    if (!element) throw new Error(`Bot Lab tuning textarea ${selector} is missing`);
    return element;
  }

  private requireButton(selector: string): HTMLButtonElement {
    const element = this.root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Bot Lab tuning button ${selector} is missing`);
    return element;
  }
}

export const botLabTuningMarkup = (config: VehicleConfig): string => `
  <button class="bot-lab-tuning-toggle" type="button" data-bot-lab-tuning-toggle>LIVE TUNING</button>
  <aside class="bot-lab-tuning" data-bot-lab-tuning-panel hidden aria-label="Bot Lab live gameplay tuning">
    <header>
      <div><small>BOT LAB // SIMULATION</small><b>GAMEPLAY TUNING</b></div>
      <button type="button" data-bot-lab-tuning-close aria-label="Close tuning panel">CLOSE</button>
    </header>
    <p>Vehicle changes are immediate. Arena and ball size rebuild the simulation.</p>
    <section class="bot-lab-tuning__geometry">
      <h2>WORLD GEOMETRY <small>REBUILD REQUIRED</small></h2>
      ${scaleFieldMarkup('arenaScale', 'Arena scale', 0.5, 3, 0.05, GAMEPLAY_SCALE.arenaScale)}
      ${scaleFieldMarkup('ballSize', 'Ball size', 0.5, 3, 0.05, GAMEPLAY_SCALE.ballSize)}
      <button type="button" data-bot-lab-tuning-rebuild>REBUILD BOT LAB</button>
    </section>
    <h2 class="bot-lab-tuning__vehicle-title">VEHICLE PERFORMANCE <small>LIVE</small></h2>
    <div class="bot-lab-tuning__fields">
      ${FIELDS.map((field) => tuningFieldMarkup(field, config[field.key])).join('')}
    </div>
    <label class="bot-lab-tuning__json">
      <span>CONFIG PREVIEW <small>TEMPORARY UNTIL COPIED</small></span>
      <textarea readonly spellcheck="false" data-bot-lab-tuning-json>${gameplayConfigJson(config)}</textarea>
    </label>
    <div class="bot-lab-tuning__actions">
      <button type="button" data-bot-lab-tuning-copy>COPY JSON</button>
      <button type="button" data-bot-lab-tuning-reset>RESET</button>
    </div>
    <output data-bot-lab-tuning-status>LIVE // USING LOADED VALUES</output>
  </aside>`;

export const gameplayConfigJson = (vehicle: VehicleConfig, scale: ScaleConfig = GAMEPLAY_SCALE): string => JSON.stringify({
  arenaScale: scale.arenaScale,
  ballSize: scale.ballSize,
  vehicle,
}, null, 2);

const tuningFieldMarkup = (field: TuningField, value: number): string => `
  <label>
    <span>${field.label}<output data-bot-lab-tuning-output="${field.key}">${formatValue(value)}</output></span>
    <input name="${field.key}" type="range" min="${field.minimum}" max="${field.maximum}" step="${field.step}" value="${value}" data-bot-lab-tuning-input>
  </label>`;

const scaleFieldMarkup = (
  key: keyof ScaleConfig,
  label: string,
  minimum: number,
  maximum: number,
  step: number,
  value: number,
): string => `
  <label>
    <span>${label}<output data-bot-lab-scale-output="${key}">${formatValue(value)}</output></span>
    <input name="${key}" type="range" min="${minimum}" max="${maximum}" step="${step}" value="${value}" data-bot-lab-scale-input>
  </label>`;

const formatValue = (value: number): string => Number.isInteger(value) ? value.toString() : value.toFixed(2);
const positiveValue = (value: number, fallback: number): number => Number.isFinite(value) && value > 0 ? value : fallback;
