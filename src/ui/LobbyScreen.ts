import { NETWORK_CONFIG } from '../networking/NetworkConfig';
import { WebSocketLobbyClient, type StartedLobby } from '../networking/WebSocketLobbyClient';
import type { LobbyPlayer, LobbySummary } from '../networking/LobbyProtocol';
import {
  DEFAULT_MATCH_SETTINGS,
  MATCH_SETTING_LIMITS,
  sanitizeMatchSettings,
  type MatchSettings,
} from '../gameplay/match/MatchSettings';
import { ChatPanel } from './ChatPanel';

export interface GameLaunch {
  readonly lobby: StartedLobby | null;
  readonly settings: MatchSettings;
  readonly mode: 'standard' | 'botTraining';
}

export class LobbyScreen {
  private client: WebSocketLobbyClient | null = null;
  private status = '';
  private matchSettings = DEFAULT_MATCH_SETTINGS;
  private browserRequestId = 0;
  private lobbySubscriptions: Array<() => void> = [];
  private chatPanel: ChatPanel | null = null;

  constructor(private readonly root: HTMLElement) {}

  show(): Promise<GameLaunch> {
    localStorage.removeItem('velocity-pitch:match-settings');
    return new Promise((resolve) => this.renderEntry(resolve));
  }

  resume(lobby: StartedLobby): Promise<GameLaunch> {
    this.client = lobby.client;
    this.matchSettings = lobby.client.currentMatchSettings();
    this.status = '';
    return new Promise((resolve) => { void this.waitForLobbyStart(resolve); });
  }

  private renderEntry(resolve: (value: GameLaunch) => void): void {
    const invitedLobby = new URLSearchParams(window.location.search).get('lobby')?.toUpperCase() ?? '';
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card">
          <p class="eyebrow">HIGH-SPEED ARENA FOOTBALL</p>
          <h1>VELOCITY PITCH</h1>
          <p class="lobby-status" data-lobby-status>${invitedLobby ? `Multiplayer invite for ${escapeHtml(invitedLobby)} detected.` : ''}</p>
          <div class="lobby-actions">
            <button type="button" data-single-player>SINGLE PLAYER</button>
            <button type="button" data-multiplayer>MULTIPLAYER</button>
            <button class="bot-lab-button" type="button" data-bot-training>3V3 BOT LAB <small>TEMP</small></button>
          </div>
        </section>
      </main>`;
    this.require('[data-multiplayer]').addEventListener('click', () => {
      void this.showLobbyBrowser(resolve, loadDriverName());
    });
    this.require('[data-single-player]').addEventListener('click', () => {
      this.renderSinglePlayer(resolve);
    });
    this.require('[data-bot-training]').addEventListener('click', () => {
      resolve({ lobby: null, settings: DEFAULT_MATCH_SETTINGS, mode: 'botTraining' });
    });
  }

  private renderCreateLobby(resolve: (value: GameLaunch) => void, playerName: string): void {
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card">
          <p class="eyebrow">HOST SETUP</p>
          <h1>CREATE LOBBY</h1>
          <label>DRIVER NAME<input data-player-name maxlength="20" value="${escapeHtml(playerName)}"></label>
          <label>LOBBY NAME<input data-lobby-name maxlength="30" value="${escapeHtml(`${playerName.trim() || 'Driver'}'s Lobby`)}"></label>
          <label>LOBBY PASSWORD <small>(OPTIONAL)</small><input data-lobby-password type="password" maxlength="64" autocomplete="new-password" placeholder="Leave blank for a public lobby"></label>
          ${this.matchSettingsMarkup(false)}
          <p class="lobby-status" data-lobby-status>${escapeHtml(this.status)}</p>
          <div class="lobby-actions">
            <button type="button" data-confirm-create>CREATE LOBBY</button>
            <button type="button" data-back>BACK</button>
          </div>
        </section>
      </main>`;
    const name = this.requireInput('[data-player-name]');
    this.bindDriverName(name);
    const lobbyName = this.requireInput('[data-lobby-name]');
    const password = this.requireInput('[data-lobby-password]');
    this.bindMatchSettingsControls((settings) => { this.matchSettings = settings; });
    this.require('[data-confirm-create]').addEventListener('click', () => {
      void this.connectAndWait('create', name.value, '', password.value, resolve, lobbyName.value);
    });
    this.require('[data-back]').addEventListener('click', () => {
      void this.showLobbyBrowser(resolve, name.value);
    });
  }

  private renderSinglePlayer(resolve: (value: GameLaunch) => void): void {
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card">
          <p class="eyebrow">SOLO GARAGE</p>
          <h1>SINGLE PLAYER</h1>
          <p class="lobby-status" data-single-player-summary></p>
          ${this.matchSettingsMarkup(false)}
          <div class="lobby-actions">
            <button type="button" data-start-single-player></button>
            <button type="button" data-back>BACK</button>
          </div>
        </section>
      </main>`;
    this.bindMatchSettingsControls((settings) => {
      this.matchSettings = settings;
      this.updateSinglePlayerCopy();
    });
    this.updateSinglePlayerCopy();
    this.require('[data-start-single-player]').addEventListener('click', () => {
      resolve({ lobby: null, settings: this.matchSettings, mode: 'standard' });
    });
    this.require('[data-back]').addEventListener('click', () => this.renderEntry(resolve));
  }

  private async connectAndWait(
    action: 'create' | 'join',
    rawName: string,
    rawCode: string,
    password: string,
    resolve: (value: GameLaunch) => void,
    lobbyName = '',
  ): Promise<void> {
    const name = rawName.trim() || 'Driver';
    saveDriverName(name);
    this.setStatus('Connecting to multiplayer service...');
    try {
      this.client ??= await WebSocketLobbyClient.connect();
      if (action === 'create') await this.client.createLobby(name, this.matchSettings, password, lobbyName);
      else await this.client.joinLobby(rawCode, name, password);
      this.matchSettings = this.client.currentMatchSettings();
      this.status = '';
      await this.waitForLobbyStart(resolve);
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.setStatus(error instanceof Error ? error.message : 'Unable to join lobby');
    }
  }

  private async waitForLobbyStart(resolve: (value: GameLaunch) => void): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.clearLobbySubscriptions();
    this.lobbySubscriptions.push(client.onRoster((players) => this.renderWaiting(players, resolve)));
    this.lobbySubscriptions.push(client.onMatchSettings((settings) => {
      this.matchSettings = settings;
      this.updateMatchSettingsControls(settings);
    }));
    this.lobbySubscriptions.push(client.onError((message) => this.setStatus(message)));
    this.lobbySubscriptions.push(client.onRemoved((reason) => {
      this.returnToMainMenu(resolve, reason);
    }));
    const started = await client.waitForStart();
    this.clearLobbySubscriptions();
    resolve({ lobby: started, settings: started.settings, mode: 'standard' });
  }

  private async showLobbyBrowser(resolve: (value: GameLaunch) => void, playerName: string): Promise<void> {
    const requestId = ++this.browserRequestId;
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card lobby-card--browser">
          <p class="eyebrow">NETWORK GARAGE</p>
          <h1>MULTIPLAYER</h1>
          <p class="lobby-status" data-lobby-status>Scanning for open lobbies...</p>
          <div class="lobby-list lobby-list--loading"></div>
          <div class="lobby-actions"><button type="button" data-back>BACK</button></div>
        </section>
      </main>`;
    this.require('[data-back]').addEventListener('click', () => {
      this.browserRequestId += 1;
      this.client?.close();
      this.client = null;
      this.renderEntry(resolve);
    });
    try {
      this.client?.close();
      this.client = await WebSocketLobbyClient.connect();
      const lobbies = await this.client.listLobbies();
      if (requestId !== this.browserRequestId) return;
      this.status = '';
      this.renderLobbyBrowser(resolve, playerName, lobbies);
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.setStatus(error instanceof Error ? error.message : 'Unable to load lobbies');
    }
  }

  private renderLobbyBrowser(
    resolve: (value: GameLaunch) => void,
    playerName: string,
    lobbies: readonly LobbySummary[],
  ): void {
    const invitedLobby = new URLSearchParams(window.location.search).get('lobby')?.toUpperCase() ?? '';
    const displayedLobbies = [...lobbies].sort((left, right) => (
      Number(right.id === invitedLobby) - Number(left.id === invitedLobby)
    ));
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card lobby-card--browser">
          <p class="eyebrow">NETWORK GARAGE</p>
          <h1>MULTIPLAYER</h1>
          <label>DRIVER NAME<input data-player-name maxlength="20" value="${escapeHtml(playerName)}"></label>
          <div class="lobby-directory-heading"><b>LOBBY BROWSER</b><span>${displayedLobbies.length} OPEN</span></div>
          <div class="lobby-list">
            ${displayedLobbies.length ? displayedLobbies.map((lobby) => lobbyBrowserRow(lobby, lobby.id === invitedLobby)).join('') : '<p class="lobby-empty">NO OPEN LOBBIES FOUND</p>'}
          </div>
          <p class="lobby-status" data-lobby-status>${escapeHtml(this.status)}</p>
          <div class="lobby-actions">
            <button type="button" data-create-lobby>CREATE LOBBY</button>
            <button type="button" data-refresh-lobbies>REFRESH</button>
            <button type="button" data-back>BACK</button>
          </div>
        </section>
      </main>`;
    const name = this.requireInput('[data-player-name]');
    this.bindDriverName(name);
    this.require('[data-create-lobby]').addEventListener('click', () => {
      this.renderCreateLobby(resolve, name.value);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-browser-join]').forEach((button) => {
      button.addEventListener('click', () => {
        const lobbyId = button.dataset.browserJoin ?? '';
        const password = this.root.querySelector<HTMLInputElement>(`[data-browser-password="${lobbyId}"]`)?.value ?? '';
        void this.connectAndWait('join', name.value, lobbyId, password, resolve);
      });
    });
    this.require('[data-refresh-lobbies]').addEventListener('click', () => {
      void this.refreshLobbyBrowser(resolve, name.value);
    });
    this.require('[data-back]').addEventListener('click', () => {
      this.browserRequestId += 1;
      this.client?.close();
      this.client = null;
      this.renderEntry(resolve);
    });
  }

  private async refreshLobbyBrowser(resolve: (value: GameLaunch) => void, playerName: string): Promise<void> {
    const requestId = ++this.browserRequestId;
    this.setStatus('Refreshing lobby list...');
    try {
      if (!this.client) this.client = await WebSocketLobbyClient.connect();
      const lobbies = await this.client.listLobbies();
      if (requestId !== this.browserRequestId) return;
      this.status = '';
      this.renderLobbyBrowser(resolve, playerName, lobbies);
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.setStatus(error instanceof Error ? error.message : 'Unable to refresh lobbies');
    }
  }

  private renderWaiting(players: readonly LobbyPlayer[], resolve: (value: GameLaunch) => void): void {
    if (!this.client) return;
    this.chatPanel?.dispose();
    const lobbyId = this.client.currentLobbyId();
    const lobbyName = this.client.currentLobbyName();
    const inviteUrl = `${NETWORK_CONFIG.publicGameUrl}/?lobby=${lobbyId}`;
    const humanPlayers = players.filter((player) => !player.bot).length;
    const maximumPlayers = this.matchSettings.teamSize * 2;
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card lobby-card--waiting">
          <header class="lobby-waiting__header">
            <div>
              <p class="eyebrow">LOBBY ${lobbyId}</p>
              <h1>${escapeHtml(lobbyName || (this.client.isHost() ? 'YOUR LOBBY' : 'WAITING FOR HOST'))}</h1>
            </div>
            <div class="lobby-waiting__format">
              <strong>${this.matchSettings.teamSize}V${this.matchSettings.teamSize}</strong>
              <span>${humanPlayers}/${maximumPlayers} HUMAN DRIVERS</span>
            </div>
          </header>
          <div class="lobby-waiting__grid">
            <section class="lobby-waiting__panel lobby-waiting__setup">
              <header class="lobby-waiting__panel-title"><b>MATCH SETUP</b><span>HOST CONFIGURATION</span></header>
              ${this.matchSettingsMarkup(!this.client.isHost())}
              <label>INVITE LINK
                <span class="invite-link-field">
                  <input data-invite-url readonly value="${escapeHtml(inviteUrl)}">
                  <button type="button" data-copy-invite aria-label="Copy invite link">COPY</button>
                </span>
              </label>
            </section>
            <section class="lobby-waiting__panel lobby-waiting__social">
              <header class="lobby-waiting__panel-title"><b>DRIVER GRID</b><span>${players.length} SLOTS READY</span></header>
              <div class="lobby-roster">${players.map((player) => playerRow(player, this.client?.isHost() ?? false)).join('')}</div>
              <div class="lobby-chat" data-chat-panel></div>
            </section>
          </div>
          <footer class="lobby-waiting__footer">
            <p class="lobby-status" data-lobby-status>${escapeHtml(this.status)}</p>
            <div class="lobby-actions">
              ${this.client.isHost() ? '<button type="button" data-start-match>START MATCH</button>' : ''}
              <button class="leave-match" type="button" data-leave-waiting>LEAVE LOBBY</button>
            </div>
          </footer>
        </section>
      </main>`;
    this.bindMatchSettingsControls((settings) => this.client?.updateMatchSettings(settings));
    this.chatPanel = new ChatPanel(this.require('[data-chat-panel]'), {
      messages: this.client.currentChatMessages(),
      send: (text, channel) => this.client?.sendChat(text, channel) ?? false,
      subscribe: (handler) => this.client?.onChat(handler) ?? (() => {}),
    }, { mode: 'lobby', config: { closeAfterSend: false } });
    this.require('[data-copy-invite]').addEventListener('click', () => {
      void navigator.clipboard.writeText(inviteUrl).then(() => this.setStatus('Invite link copied'));
    });
    this.root.querySelector('[data-start-match]')?.addEventListener('click', () => this.client?.startMatch());
    this.root.querySelectorAll<HTMLButtonElement>('[data-set-player-team]').forEach((button) => {
      button.addEventListener('click', () => {
        const playerId = button.dataset.setPlayerTeam;
        const team = button.dataset.team;
        if (playerId && (team === 'azure' || team === 'coral')) this.client?.setPlayerTeam(playerId, team);
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-kick-player]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.kickPlayer) this.client?.kickPlayer(button.dataset.kickPlayer);
      });
    });
    this.require('[data-leave-waiting]').addEventListener('click', () => this.returnToMainMenu(resolve, ''));
  }

  private returnToMainMenu(resolve: (value: GameLaunch) => void, status: string): void {
    this.clearLobbySubscriptions();
    this.client?.close();
    this.client = null;
    this.status = status;
    this.renderEntry(resolve);
  }

  private clearLobbySubscriptions(): void {
    this.chatPanel?.dispose();
    this.chatPanel = null;
    this.lobbySubscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  }

  private matchSettingsMarkup(disabled: boolean): string {
    const disabledAttribute = disabled ? ' disabled' : '';
    return `
      <section class="match-settings" data-match-settings>
        <div class="match-settings__heading">
          <b>MATCH TUNING</b><span>${disabled ? 'HOST CONTROLLED' : 'SESSION ONLY'}</span>
        </div>
        ${matchRange(
          'TEAM SIZE',
          'team-size',
          this.matchSettings.teamSize,
          MATCH_SETTING_LIMITS.teamSize,
          'V',
          disabledAttribute,
        )}
        ${matchRange(
          'AUTO BOOST REFILL',
          'boost-recharge',
          this.matchSettings.boostRechargePerSecond,
          MATCH_SETTING_LIMITS.boostRechargePerSecond,
          '/s',
          disabledAttribute,
        )}
        ${matchRange(
          'BOOST POWER',
          'boost-power',
          this.matchSettings.boostPowerMultiplier,
          MATCH_SETTING_LIMITS.boostPowerMultiplier,
          'x',
          disabledAttribute,
        )}
        ${matchRange(
          'HIT POWER',
          'hit-power',
          this.matchSettings.hitPowerMultiplier,
          MATCH_SETTING_LIMITS.hitPowerMultiplier,
          'x',
          disabledAttribute,
        )}
      </section>`;
  }

  private bindMatchSettingsControls(handler: (settings: MatchSettings) => void): void {
    const inputs = this.matchSettingInputs();
    if (!inputs) return;
    const update = (): void => {
      const settings = sanitizeMatchSettings({
        teamSize: Number(inputs.teamSize.value),
        boostRechargePerSecond: Number(inputs.recharge.value),
        boostPowerMultiplier: Number(inputs.boostPower.value),
        hitPowerMultiplier: Number(inputs.hitPower.value),
      });
      this.matchSettings = settings;
      this.updateMatchSettingsControls(settings);
      handler(settings);
    };
    Object.values(inputs).forEach((input) => input.addEventListener('input', update));
    this.updateMatchSettingsControls(this.matchSettings);
  }

  private updateMatchSettingsControls(settings: MatchSettings): void {
    const inputs = this.matchSettingInputs();
    if (!inputs) return;
    inputs.teamSize.value = settings.teamSize.toString();
    inputs.recharge.value = settings.boostRechargePerSecond.toString();
    inputs.boostPower.value = settings.boostPowerMultiplier.toString();
    inputs.hitPower.value = settings.hitPowerMultiplier.toString();
    this.setMatchOutput('boost-recharge', `${settings.boostRechargePerSecond}/s`);
    this.setMatchOutput('team-size', `${settings.teamSize}V${settings.teamSize}`);
    this.setMatchOutput('boost-power', `${settings.boostPowerMultiplier.toFixed(1)}x`);
    this.setMatchOutput('hit-power', `${settings.hitPowerMultiplier.toFixed(1)}x`);
  }

  private matchSettingInputs(): {
    readonly teamSize: HTMLInputElement;
    readonly recharge: HTMLInputElement;
    readonly boostPower: HTMLInputElement;
    readonly hitPower: HTMLInputElement;
  } | null {
    const teamSize = this.root.querySelector<HTMLInputElement>('[name="team-size"]');
    const recharge = this.root.querySelector<HTMLInputElement>('[name="boost-recharge"]');
    const boostPower = this.root.querySelector<HTMLInputElement>('[name="boost-power"]');
    const hitPower = this.root.querySelector<HTMLInputElement>('[name="hit-power"]');
    return teamSize && recharge && boostPower && hitPower
      ? { teamSize, recharge, boostPower, hitPower }
      : null;
  }

  private updateSinglePlayerCopy(): void {
    const format = `${this.matchSettings.teamSize}V${this.matchSettings.teamSize}`;
    const botCount = this.matchSettings.teamSize * 2 - 1;
    const summary = this.root.querySelector<HTMLElement>('[data-single-player-summary]');
    const button = this.root.querySelector<HTMLButtonElement>('[data-start-single-player]');
    if (summary) summary.textContent = `${format} // DRIVER + ${botCount} ${botCount === 1 ? 'BOT' : 'BOTS'}`;
    if (button) button.textContent = `START ${format} MATCH`;
  }

  private setMatchOutput(name: string, value: string): void {
    const output = this.root.querySelector<HTMLOutputElement>(`[data-match-output="${name}"]`);
    if (output) output.value = value;
  }

  private setStatus(message: string): void {
    this.status = message;
    const element = this.root.querySelector<HTMLElement>('[data-lobby-status]');
    if (element) element.textContent = message;
  }

  private bindDriverName(input: HTMLInputElement): void {
    input.addEventListener('input', () => saveDriverName(input.value));
  }

  private require(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Lobby element ${selector} is missing`);
    return element;
  }

  private requireInput(selector: string): HTMLInputElement {
    const element = this.root.querySelector<HTMLInputElement>(selector);
    if (!element) throw new Error(`Lobby input ${selector} is missing`);
    return element;
  }
}

const playerRow = (player: LobbyPlayer, hostControls: boolean): string => `
  <div class="lobby-player lobby-player--${player.team}">
    <span>${escapeHtml(player.name)}</span>
    <b>${player.team.toUpperCase()}${player.host ? ' // HOST' : ''}</b>
    ${hostControls && !player.bot ? `<span class="lobby-player__controls">
      <button type="button" data-set-player-team="${escapeHtml(player.id)}" data-team="${player.team === 'azure' ? 'coral' : 'azure'}">MOVE TO ${player.team === 'azure' ? 'CORAL' : 'AZURE'}</button>
      ${player.host ? '' : `<button class="lobby-player__kick" type="button" data-kick-player="${escapeHtml(player.id)}">KICK</button>`}
    </span>` : ''}
  </div>`;

const lobbyBrowserRow = (lobby: LobbySummary, invited: boolean): string => `
  <article class="lobby-browser-row${invited ? ' lobby-browser-row--invited' : ''}">
    <div class="lobby-browser-row__summary">
      <span class="lobby-browser-row__code">${escapeHtml(lobby.id)}</span>
      <span class="lobby-browser-row__name">${escapeHtml(lobby.name)}</span>
      <span class="lobby-browser-row__host">HOST: ${escapeHtml(lobby.hostName)}</span>
      <b>${lobby.teamSize}V${lobby.teamSize} // ${lobby.playerCount}/${lobby.maximumPlayers} DRIVERS</b>
      <i>${invited ? 'INVITED' : lobby.passwordProtected ? 'LOCKED' : 'OPEN'}</i>
    </div>
    ${lobby.passwordProtected ? `<input data-browser-password="${escapeHtml(lobby.id)}" type="password" maxlength="64" autocomplete="current-password" placeholder="Lobby password" aria-label="Password for lobby ${escapeHtml(lobby.id)}">` : ''}
    <button type="button" data-browser-join="${escapeHtml(lobby.id)}">JOIN</button>
  </article>`;

const matchRange = (
  label: string,
  name: string,
  value: number,
  limits: { readonly minimum: number; readonly maximum: number; readonly step: number },
  suffix: string,
  disabledAttribute: string,
): string => `
  <label class="match-setting">
    <span>${label}<output data-match-output="${name}">${value}${suffix}</output></span>
    <input name="${name}" type="range" min="${limits.minimum}" max="${limits.maximum}" step="${limits.step}" value="${value}"${disabledAttribute}>
  </label>`;

const saveDriverName = (name: string): void => {
  try {
    localStorage.setItem('velocity-pitch-name', name.slice(0, 20));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
};

const loadDriverName = (): string => {
  try {
    return localStorage.getItem('velocity-pitch-name')?.trim() || 'Driver';
  } catch {
    return 'Driver';
  }
};

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character] ?? character);
