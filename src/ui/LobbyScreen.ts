import { NETWORK_CONFIG } from '../networking/NetworkConfig';
import { WebSocketLobbyClient, type StartedLobby } from '../networking/WebSocketLobbyClient';
import type { LobbyPlayer } from '../networking/LobbyProtocol';

export class LobbyScreen {
  private client: WebSocketLobbyClient | null = null;
  private status = '';

  constructor(private readonly root: HTMLElement) {}

  show(): Promise<StartedLobby | null> {
    return new Promise((resolve) => this.renderEntry(resolve));
  }

  private renderEntry(resolve: (value: StartedLobby | null) => void): void {
    const invitedLobby = new URLSearchParams(window.location.search).get('lobby')?.toUpperCase() ?? '';
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card">
          <p class="eyebrow">NETWORK GARAGE</p>
          <h1>VELOCITY PITCH</h1>
          <label>DRIVER NAME<input data-player-name maxlength="20" value="${escapeHtml(localStorage.getItem('velocity-pitch-name') ?? '')}"></label>
          <label>LOBBY CODE<input data-lobby-code maxlength="6" value="${escapeHtml(invitedLobby)}"></label>
          <p class="lobby-status" data-lobby-status>${invitedLobby ? 'Invite detected. Enter your name and join.' : ''}</p>
          <div class="lobby-actions">
            <button type="button" data-create-lobby>CREATE LOBBY</button>
            <button type="button" data-join-lobby>JOIN LOBBY</button>
            <button type="button" data-single-player>SINGLE PLAYER</button>
          </div>
        </section>
      </main>`;
    const name = this.requireInput('[data-player-name]');
    const code = this.requireInput('[data-lobby-code]');
    this.require('[data-create-lobby]').addEventListener('click', () => {
      void this.connectAndWait('create', name.value, code.value, resolve);
    });
    this.require('[data-join-lobby]').addEventListener('click', () => {
      void this.connectAndWait('join', name.value, code.value, resolve);
    });
    this.require('[data-single-player]').addEventListener('click', () => resolve(null));
  }

  private async connectAndWait(
    action: 'create' | 'join',
    rawName: string,
    rawCode: string,
    resolve: (value: StartedLobby | null) => void,
  ): Promise<void> {
    const name = rawName.trim() || 'Driver';
    localStorage.setItem('velocity-pitch-name', name);
    this.setStatus('Connecting to multiplayer service...');
    try {
      this.client = await WebSocketLobbyClient.connect();
      if (action === 'create') await this.client.createLobby(name);
      else await this.client.joinLobby(rawCode, name);
      this.client.onRoster((players) => this.renderWaiting(players));
      this.client.onError((message) => this.setStatus(message));
      const started = await this.client.waitForStart();
      resolve(started);
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.setStatus(error instanceof Error ? error.message : 'Unable to join lobby');
    }
  }

  private renderWaiting(players: readonly LobbyPlayer[]): void {
    if (!this.client) return;
    const lobbyId = this.client.currentLobbyId();
    const inviteUrl = `${NETWORK_CONFIG.publicGameUrl}/?lobby=${lobbyId}`;
    this.root.innerHTML = `
      <main class="lobby-screen">
        <section class="lobby-card">
          <p class="eyebrow">LOBBY ${lobbyId}</p>
          <h1>${this.client.isHost() ? 'YOUR LOBBY' : 'WAITING FOR HOST'}</h1>
          <div class="lobby-roster">${players.map(playerRow).join('')}</div>
          <label>INVITE LINK<input data-invite-url readonly value="${escapeHtml(inviteUrl)}"></label>
          <p class="lobby-status" data-lobby-status>${escapeHtml(this.status)}</p>
          <div class="lobby-actions">
            <button type="button" data-copy-invite>COPY INVITE</button>
            ${this.client.isHost() ? '<button type="button" data-start-match>START MATCH</button>' : ''}
          </div>
        </section>
      </main>`;
    this.require('[data-copy-invite]').addEventListener('click', () => {
      void navigator.clipboard.writeText(inviteUrl).then(() => this.setStatus('Invite link copied'));
    });
    this.root.querySelector('[data-start-match]')?.addEventListener('click', () => this.client?.startMatch());
  }

  private setStatus(message: string): void {
    this.status = message;
    const element = this.root.querySelector<HTMLElement>('[data-lobby-status]');
    if (element) element.textContent = message;
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

const playerRow = (player: LobbyPlayer): string => `
  <div class="lobby-player lobby-player--${player.team}">
    <span>${escapeHtml(player.name)}</span><b>${player.team.toUpperCase()}${player.host ? ' // HOST' : ''}</b>
  </div>`;

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character] ?? character);
