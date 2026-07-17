import {
  createSessionActor,
  SessionActorDirectory,
  createSystemClock,
  projectRoom,
  projectEvents,
} from '../session/index.js';
import type {
  RoomRecord,
  SessionActor,
  SessionCommand,
  SessionDeps,
  SessionEffect,
  Recipient,
  CommandResponse,
  Clock,
} from '../session/index.js';
import { warn as logWarn } from '../core/logging.js';
import type { DraftEngineEvent } from '../engine/index.js';
import type { ServerMessage } from './protocol.js';


/** A live connection, from the hub's point of view. */
export interface HubConnection {
  /** Admitted Discord user id (stable for the connection's life). */
  readonly userId: string;
  /** Admitted staff flag (god-view when unseated). Re-evaluated against seat each fan-out. */
  readonly staff: boolean;
  /** Send a server frame (JSON-serialized by the adapter). Must not throw on a closed socket. */
  send(message: ServerMessage): void;
  /** Close the underlying transport with a code + reason. */
  close(code: number, reason: string): void;
}

export interface ActivityHubOptions {
  /** Deps for the session reducer (now + rng). */
  deps: SessionDeps;
  /** Clock for actor deadlines; defaults to the system clock. */
  clock?: Clock;
}

export class ActivityHub {
  private readonly directory = new SessionActorDirectory();
  private readonly connections = new Map<string, Set<HubConnection>>();
  private readonly deps: SessionDeps;
  private readonly clock: Clock;

  constructor(options: ActivityHubOptions) {
    this.deps = options.deps;
    this.clock = options.clock ?? createSystemClock();
  }

  /**
   * Create (or supersede) the actor for a room. Returns the actor. The launch
   * bridge (R6.4) calls this; tests call it directly.
   */
  createSession(initial: RoomRecord): SessionActor {
    const sessionId = initial.id;
    return this.directory.create({
      id: sessionId,
      initial,
      deps: this.deps,
      clock: this.clock,
      executeEffects: (effects) => this.dispatch(sessionId, effects),
    });
  }

  getSession(sessionId: string): SessionActor | undefined {
    return this.directory.get(sessionId);
  }

  /** Register a connection against a session and send it the initial snapshot. */
  attach(sessionId: string, connection: HubConnection): void {
    let set = this.connections.get(sessionId);
    if (!set) {
      set = new Set();
      this.connections.set(sessionId, set);
    }
    set.add(connection);

    const actor = this.directory.get(sessionId);
    if (!actor) {
      connection.send({ type: 'reject', code: 'SESSION_NOT_FOUND', message: 'session not found' });
      return;
    }
    const recipient = this.recipientFor(actor.snapshot(), connection);
    const projection = projectRoom(actor.snapshot(), recipient);
    if ('error' in projection) {
      // Should be unreachable (admission already ran), but never leak a raw room.
      connection.send({ type: 'reject', code: 'OBSERVER_IS_SEATED', message: 'invalid observer for seated user' });
      return;
    }
    connection.send({ type: 'snapshot', snapshot: projection });
  }

  /** Deregister a connection (on socket close). */
  detach(sessionId: string, connection: HubConnection): void {
    const set = this.connections.get(sessionId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) this.connections.delete(sessionId);
  }

  /** Route a parsed command into the actor; the ack/reject reply is returned to the caller. */
  async submit(sessionId: string, command: SessionCommand): Promise<CommandResponse> {
    const actor = this.directory.get(sessionId);
    if (!actor) return { ok: false, code: 'INACTIVE', message: 'session not found' };
    return actor.enqueue(command);
  }

  /** Dispose everything (shutdown). */
  disposeAll(): void {
    this.directory.disposeAll();
    for (const set of this.connections.values()) {
      for (const connection of set) connection.close(1001, 'server shutting down');
    }
    this.connections.clear();
  }

  // ── Effect fan-out (the K7 boundary on the wire) ───────────────────────────

  private dispatch(sessionId: string, effects: readonly SessionEffect[]): void {
    const set = this.connections.get(sessionId);
    for (const effect of effects) {
      switch (effect.type) {
        case 'STATE_CHANGED':
          if (set) this.broadcastState(set, effect.room, effect.events);
          break;
        case 'NOTIFY':
          if (set) this.broadcastNotify(set, effect.target, effect.message);
          break;
        case 'SESSION_CLOSED':
          if (set) this.closeAll(set, effect.reason);
          this.connections.delete(sessionId);
          break;
        case 'TELEMETRY':
          // R6: log-and-drop. R5.5 (parallel chat) wires the real sessions.api sink.
          logWarn(`[activity] TELEMETRY dropped (R6 stub) for session ${sessionId}`);
          break;
        default:
          // STATE_CHANGED/NOTIFY/SESSION_CLOSED/TELEMETRY are the only effects the actor
          // forwards; SET_DEADLINE/CLEAR_DEADLINE are consumed inside the actor.
          break;
      }
    }
  }

  private broadcastState(
    set: ReadonlySet<HubConnection>,
    room: RoomRecord,
    events: readonly DraftEngineEvent[],
  ): void {
    for (const connection of set) {
      const recipient = this.recipientFor(room, connection);
      const projection = projectRoom(room, recipient);
      if ('error' in projection) continue; // seated-observer guard; never leak the raw room
      connection.send({
        type: 'update',
        snapshot: projection,
        events: projectEvents(events, recipient),
      });
    }
  }

  private broadcastNotify(
    set: ReadonlySet<HubConnection>,
    target: 'public' | { userId: string },
    message: string,
  ): void {
    for (const connection of set) {
      if (target === 'public' || connection.userId === target.userId) {
        connection.send({ type: 'notify', message });
      }
    }
  }

  private closeAll(set: ReadonlySet<HubConnection>, reason: string): void {
    for (const connection of set) {
      connection.send({ type: 'closed', reason });
      connection.close(1000, 'session closed');
    }
  }


  private recipientFor(room: RoomRecord, connection: HubConnection): Recipient {
    const seated = room.members[connection.userId] !== undefined;
    return seated ? { kind: 'seat', seatId: connection.userId } : { kind: 'observer', userId: connection.userId };
  }
}


export function createDetachedActor(params: {
  initial: RoomRecord;
  deps: SessionDeps;
  clock: Clock;
  executeEffects: (effects: readonly SessionEffect[], room: RoomRecord) => void;
}): SessionActor {
  return createSessionActor({
    id: params.initial.id,
    initial: params.initial,
    deps: params.deps,
    clock: params.clock,
    executeEffects: params.executeEffects,
  });
}