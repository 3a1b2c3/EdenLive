import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';

export const CARRY_RESULTS = Object.freeze({
  PICKED_UP: 'pickedUp',
  DROPPED: 'dropped',
  DEPOSITED: 'deposited',
  PROCESS_STARTED: 'processStarted',
  COLLECTED: 'collected',
  HANDS_FULL: 'handsFull',
  HANDS_EMPTY: 'handsEmpty',
  OUT_OF_RANGE: 'outOfRange',
  REJECTED: 'rejected',
  BUSY: 'busy',
});

export const STATION_STATES = Object.freeze({
  IDLE: 'idle',
  WORKING: 'working',
  DONE: 'done',
});

/**
 * One-item carrying plus timed processing stations.
 *
 * The cooking-game loop: pick up an ingredient, carry it to a station, leave it
 * there to be chopped or cooked, collect the result, and hand it in. It is
 * "interact with the nearest thing" plus "stations take time", which no existing
 * module covers.
 *
 * Design decisions worth stating, because they are what make the loop readable:
 *
 * - Hands hold exactly one item. Every failure is reported (`HANDS_FULL`,
 *   `HANDS_EMPTY`, `OUT_OF_RANGE`) rather than silently doing nothing, so the
 *   caller can play a refusal cue.
 * - A station transforms `accepts -> produces` over `processSeconds`. The recipe
 *   lives in the station, so adding a dish is data, not code.
 * - Stations run on their own once loaded; the player is free to walk away, which
 *   is the whole source of time pressure in the genre.
 *
 * Headless: items and stations are plain objects with a `position`.
 */
export class CarryStationController {
  constructor({
    interactRange = 1.8,
    verticalTolerance = 2,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(interactRange) || interactRange <= 0) {
      throw new Error('CarryStationController: interactRange must be a finite number > 0');
    }

    this.interactRange = interactRange;
    this.verticalTolerance = Math.abs(verticalTolerance);
    this.basis = basis;

    this.heldItem = null;
    this.stations = new Map();
    this.servedCount = 0;
  }

  get handsEmpty() {
    return this.heldItem === null;
  }

  /**
   * Register a station.
   *
   * `accepts` is an item type or array of types (null accepts anything);
   * `produces` is the item type handed back (null means the station consumes the
   * item, which is how a serving hatch works).
   */
  registerStation({
    id,
    position,
    accepts = null,
    produces = null,
    processSeconds = 0,
    consumesOnly = false,
  }) {
    if (id === undefined || id === null) {
      throw new Error('CarryStationController.registerStation requires an id');
    }
    if (!position) {
      throw new Error(`CarryStationController: station "${id}" requires a position`);
    }
    const acceptList = accepts === null
      ? null
      : (Array.isArray(accepts) ? [...accepts] : [accepts]);

    this.stations.set(id, {
      id,
      position,
      accepts: acceptList,
      produces,
      processSeconds: Math.max(0, processSeconds),
      consumesOnly: Boolean(consumesOnly) || produces === null,
      state: STATION_STATES.IDLE,
      remainingSeconds: 0,
      contents: null,
      output: null,
    });
    return this;
  }

  station(id) {
    return this.stations.get(id) ?? null;
  }

  /** Planar distance from a position to a station, ignoring small height gaps. */
  _withinRange(fromPosition, targetPosition) {
    if (!fromPosition || !targetPosition) return false;
    const delta = this.basis.planarDelta(targetPosition, fromPosition);
    if (Math.hypot(delta.right, delta.forward) > this.interactRange) return false;
    const heightGap = Math.abs(
      this.basis.upComponent(targetPosition) - this.basis.upComponent(fromPosition)
    );
    return heightGap <= this.verticalTolerance;
  }

  /** Nearest in-range station id, or null. */
  nearestStation(playerPosition) {
    let best = null;
    let bestDistance = Infinity;
    for (const station of this.stations.values()) {
      if (!this._withinRange(playerPosition, station.position)) continue;
      const delta = this.basis.planarDelta(station.position, playerPosition);
      const distance = Math.hypot(delta.right, delta.forward);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = station.id;
      }
    }
    return best;
  }

  /** Pick a loose item off the floor. `item` is `{type, position, ...}`. */
  pickUp(item, playerPosition) {
    if (!this.handsEmpty) return { result: CARRY_RESULTS.HANDS_FULL, item: this.heldItem };
    if (!item) return { result: CARRY_RESULTS.REJECTED, item: null };
    if (playerPosition && !this._withinRange(playerPosition, item.position)) {
      return { result: CARRY_RESULTS.OUT_OF_RANGE, item: null };
    }
    this.heldItem = item;
    return { result: CARRY_RESULTS.PICKED_UP, item };
  }

  /** Drop what is held. */
  drop() {
    if (this.handsEmpty) return { result: CARRY_RESULTS.HANDS_EMPTY, item: null };
    const item = this.heldItem;
    this.heldItem = null;
    return { result: CARRY_RESULTS.DROPPED, item };
  }

  _accepts(station, itemType) {
    if (station.accepts === null) return true;
    return station.accepts.includes(itemType);
  }

  /**
   * Interact with a station: deposit the held item, or collect a finished output.
   *
   * One button covers both, which is how these games are actually played -- the
   * station's state decides which happens.
   */
  interact(stationId, playerPosition) {
    const station = this.stations.get(stationId);
    if (!station) return { result: CARRY_RESULTS.REJECTED, stationId };
    if (playerPosition && !this._withinRange(playerPosition, station.position)) {
      return { result: CARRY_RESULTS.OUT_OF_RANGE, stationId };
    }

    // Collect a finished output first: that is what the player wants when the
    // station is beeping at them.
    if (station.state === STATION_STATES.DONE && station.output !== null) {
      if (!this.handsEmpty) return { result: CARRY_RESULTS.HANDS_FULL, stationId };
      const output = station.output;
      station.output = null;
      station.contents = null;
      station.state = STATION_STATES.IDLE;
      this.heldItem = output;
      return { result: CARRY_RESULTS.COLLECTED, stationId, item: output };
    }

    if (station.state === STATION_STATES.WORKING) {
      return { result: CARRY_RESULTS.BUSY, stationId, remainingSeconds: station.remainingSeconds };
    }
    if (this.handsEmpty) return { result: CARRY_RESULTS.HANDS_EMPTY, stationId };
    if (!this._accepts(station, this.heldItem.type)) {
      return { result: CARRY_RESULTS.REJECTED, stationId, item: this.heldItem };
    }

    const item = this.heldItem;
    this.heldItem = null;

    // A consuming station (serving hatch) takes the item and scores it.
    if (station.consumesOnly) {
      this.servedCount += 1;
      return { result: CARRY_RESULTS.DEPOSITED, stationId, item, served: true };
    }

    station.contents = item;
    if (station.processSeconds <= 0) {
      station.output = { type: station.produces, from: item };
      station.state = STATION_STATES.DONE;
      return { result: CARRY_RESULTS.DEPOSITED, stationId, item, ready: true };
    }

    station.state = STATION_STATES.WORKING;
    station.remainingSeconds = station.processSeconds;
    return { result: CARRY_RESULTS.PROCESS_STARTED, stationId, item };
  }

  /**
   * Advance every working station. Returns the ids that finished this step, so a
   * caller can play one cue per completion.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    const finished = [];

    for (const station of this.stations.values()) {
      if (station.state !== STATION_STATES.WORKING) continue;
      station.remainingSeconds -= delta;
      if (station.remainingSeconds > 0) continue;

      station.remainingSeconds = 0;
      station.output = { type: station.produces, from: station.contents };
      station.state = STATION_STATES.DONE;
      finished.push(station.id);
    }
    return finished;
  }

  snapshot() {
    return {
      heldItem: this.heldItem,
      handsEmpty: this.handsEmpty,
      servedCount: this.servedCount,
      stations: [...this.stations.values()].map((station) => ({
        id: station.id,
        state: station.state,
        remainingSeconds: station.remainingSeconds,
        contents: station.contents,
        output: station.output,
      })),
    };
  }

  reset() {
    this.heldItem = null;
    this.servedCount = 0;
    for (const station of this.stations.values()) {
      station.state = STATION_STATES.IDLE;
      station.remainingSeconds = 0;
      station.contents = null;
      station.output = null;
    }
    return this;
  }
}
