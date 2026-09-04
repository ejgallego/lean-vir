/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { registerHostCallRollback } from "../host-boundary.js";
import {
  collectCleanupError,
  throwCollectedErrors,
} from "../runtime/cleanup.js";

export class HostLifecycle {
  constructor() {
    this.phase = "active";
    this.activeCleanups = new Map();
  }

  addDisposable(value, cleanup) {
    if (typeof cleanup !== "function") {
      throw new Error("active host cleanup must be a function");
    }
    try {
      this.requireActive();
    } catch (error) {
      const errors = [error];
      collectCleanupError(errors, cleanup);
      throwCollectedErrors(
        errors,
        "active host value registration failed during rollback",
      );
    }
    this.activeCleanups.set(value, cleanup);
    return undefined;
  }

  removeDisposable(value) {
    this.activeCleanups.delete(value);
    return undefined;
  }

  // Debug-only lifecycle visibility for runtime tests; not a stable host API.
  debugResourceCounts() {
    return {
      active: this.activeCleanups.size,
    };
  }

  dispose() {
    if (this.phase === "disposed" || this.phase === "disposing")
      return undefined;
    this.phase = "disposing";
    const errors = [];
    try {
      for (const cleanup of Array.from(this.activeCleanups.values())) {
        collectCleanupError(errors, cleanup);
      }
      this.activeCleanups.clear();
    } finally {
      this.phase = "disposed";
    }
    throwCollectedErrors(errors, "host lifecycle disposal failed");
    return undefined;
  }

  requireActive() {
    if (this.phase !== "active") {
      throw new Error(
        "host lifecycle cannot register active resources while disposing or disposed",
      );
    }
  }
}

export function createHostLifecycle() {
  return new HostLifecycle();
}

export function createTimerHostBindings(lifecycle) {
  const timeouts = new Map();
  const intervals = new Map();
  return {
    "browser.timer.setTimeout": (callback, delayMs) => {
      const registration = createCallbackRegistration(lifecycle, callback, {
        oneShot: true,
        schedule: (run) => globalThis.setTimeout(run, delayMs),
        cancel: globalThis.clearTimeout.bind(globalThis),
        onInactive: (token) => timeouts.delete(token),
      });
      if (registration.active) timeouts.set(registration.token, registration);
      registerHostCallRollback(registration.dispose);
      return registration.token;
    },
    "browser.timer.clearTimeout": (timeout) => {
      const registration = timeouts.get(timeout);
      if (registration === undefined) globalThis.clearTimeout(timeout);
      else registration.dispose();
      return undefined;
    },
    "browser.timer.setInterval": (callback, delayMs) => {
      const registration = createCallbackRegistration(lifecycle, callback, {
        oneShot: false,
        schedule: (run) => globalThis.setInterval(run, delayMs),
        cancel: globalThis.clearInterval.bind(globalThis),
        onInactive: (token) => intervals.delete(token),
      });
      intervals.set(registration.token, registration);
      registerHostCallRollback(registration.dispose);
      return registration.token;
    },
    "browser.timer.clearInterval": (interval) => {
      const registration = intervals.get(interval);
      if (registration === undefined) globalThis.clearInterval(interval);
      else registration.dispose();
      return undefined;
    },
  };
}

export function createAnimationHostBindings(
  lifecycle,
  { requestFrame, cancelFrame },
) {
  const frames = new Map();
  return {
    "browser.animation.requestAnimationFrame": (callback) => {
      const registration = createCallbackRegistration(lifecycle, callback, {
        oneShot: true,
        schedule: requestFrame,
        cancel: cancelFrame,
        onInactive: (token) => frames.delete(token),
      });
      if (registration.active) frames.set(registration.token, registration);
      registerHostCallRollback(registration.dispose);
      return registration.token;
    },
    "browser.animation.cancelAnimationFrame": (frame) => {
      const registration = frames.get(frame);
      if (registration === undefined) cancelFrame(frame);
      else registration.dispose();
      return undefined;
    },
  };
}

function createCallbackRegistration(
  lifecycle,
  callback,
  { oneShot, schedule, cancel, onInactive },
) {
  let token;
  let active = true;
  const registration = {
    get token() {
      return token;
    },
    get active() {
      return active;
    },
    dispose: () => {
      if (!active) return undefined;
      active = false;
      lifecycle.removeDisposable(registration);
      onInactive?.(token);
      cancel(token);
      return undefined;
    },
  };
  const run = (...args) => {
    if (!active) return undefined;
    if (oneShot) {
      active = false;
      lifecycle.removeDisposable(registration);
      onInactive?.(token);
    }
    return callback(...args);
  };
  token = schedule(run);
  if (active) {
    lifecycle.addDisposable(registration, registration.dispose);
  }
  return registration;
}
