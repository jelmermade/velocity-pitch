import type { PlayerCommand } from './PlayerCommand';

export interface TickCommand {
  readonly tick: number;
  readonly command: PlayerCommand;
}

export class PlayerCommandBuffer {
  private readonly commands = new Map<number, PlayerCommand>();

  set(tick: number, command: PlayerCommand): void {
    this.commands.set(tick, command);
  }

  take(tick: number): PlayerCommand | undefined {
    const command = this.commands.get(tick);
    this.commands.delete(tick);
    return command;
  }

  discardBefore(tick: number): void {
    this.commands.forEach((_command, commandTick) => {
      if (commandTick < tick) this.commands.delete(commandTick);
    });
  }
}
