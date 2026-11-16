/**
 * RoomStore seam (design doc §4 / Appendix B): the one place rooms are looked
 * up. It holds live Room objects, phase timers included, so it is not a
 * drop-in point for an external store like Redis: a Room's timers only run in
 * the process that holds it. Scaling past one process means routing each
 * room's players to the process that owns it (sticky routing).
 */
import type { Room } from './Room.js';

export interface RoomStore {
  get(code: string): Room | undefined;
  has(code: string): boolean;
  set(room: Room): void;
  delete(code: string): void;
  codes(): string[];
  count(): number;
}

export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }
  has(code: string): boolean {
    return this.rooms.has(code);
  }
  set(room: Room): void {
    this.rooms.set(room.code, room);
  }
  delete(code: string): void {
    this.rooms.delete(code);
  }
  codes(): string[] {
    return [...this.rooms.keys()];
  }
  count(): number {
    return this.rooms.size;
  }
}
