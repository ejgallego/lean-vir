/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function elapsed(now, started) {
  return Math.max(0, now() - started);
}

/** Internal accumulator used only by the opt-in `VirRuntime.callTimed` path. */
export class RuntimeCallTiming {
  constructor(now = defaultNow) {
    if (typeof now !== "function") throw new TypeError("runtime call clock must be a function");
    this.now = now;
    this.started = now();
    this.marshalMs = 0;
    this.executeMs = 0;
    this.decodeMs = 0;
    this.hostMs = 0;
    this.hostDepth = 0;
    this.finished = false;
  }

  beginPhase() {
    if (this.finished) throw new Error("runtime call timing is already finished");
    return this.now();
  }

  endMarshal(started) {
    this.endPhase("marshalMs", started);
  }

  endExecute(started) {
    this.endPhase("executeMs", started);
  }

  endDecode(started) {
    this.endPhase("decodeMs", started);
  }

  beginHost() {
    const started = this.hostDepth === 0 ? this.now() : null;
    this.hostDepth++;
    return started;
  }

  endHost(started) {
    if (this.hostDepth === 0) throw new Error("runtime host call timing is inconsistent");
    this.hostDepth--;
    if (started !== null) this.hostMs += elapsed(this.now, started);
  }

  endPhase(name, started) {
    this[name] += elapsed(this.now, started);
  }

  finish() {
    if (this.finished) throw new Error("runtime call timing is already finished");
    if (this.hostDepth !== 0) throw new Error("runtime call timing has an active host import");
    this.finished = true;
    return {
      marshalMs: this.marshalMs,
      executeMs: this.executeMs,
      decodeMs: this.decodeMs,
      hostMs: this.hostMs,
      totalMs: elapsed(this.now, this.started),
    };
  }
}
