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

  stageResult(value, { onAbort = null } = {}) {
    this.requireActive();
    if (typeof onAbort === "function") registerHostCallRollback(onAbort);
    return value;
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

export function createTimerHostBindings(resources) {
  const timeouts = new Map();
  const intervals = new Map();
  return {
    "browser.timer.setTimeout": (delayMs, callback) => {
      const delay = jsNatAsDelay(delayMs);
      const registration = createScheduledCallbackRegistration(
        resources,
        callback,
        {
          label: "browser timeout",
          schedule: (run) => globalThis.setTimeout(run, delay),
          cancel: globalThis.clearTimeout.bind(globalThis),
          invoke: (leanCallback) => leanCallback(),
          onInactive: (token) => timeouts.delete(token),
        },
      );
      if (registration.active) timeouts.set(registration.token, registration);
      return resources.stageResult(registration.token, {
        onAbort: registration.dispose,
      });
    },
    "browser.timer.clearTimeout": (timeout) => {
      const registration = timeouts.get(timeout);
      if (registration === undefined) globalThis.clearTimeout(timeout);
      else registration.dispose();
      return undefined;
    },
    "browser.timer.setInterval": (delayMs, callback) => {
      const delay = jsNatAsDelay(delayMs);
      const registration = createRecurringCallbackRegistration(
        resources,
        callback,
        {
          label: "browser interval",
          schedule: (run) => globalThis.setInterval(run, delay),
          cancel: globalThis.clearInterval.bind(globalThis),
          invoke: (leanCallback) => leanCallback(),
          onInactive: (token) => intervals.delete(token),
        },
      );
      intervals.set(registration.token, registration);
      return resources.stageResult(registration.token, {
        onAbort: registration.dispose,
      });
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
  resources,
  { requestFrame, cancelFrame },
) {
  const frames = new Map();
  return {
    "browser.animation.requestAnimationFrame": (callback) => {
      const registration = createScheduledCallbackRegistration(
        resources,
        callback,
        {
          label: "browser animation frame",
          schedule: requestFrame,
          cancel: cancelFrame,
          invoke: (leanCallback, timestamp) => leanCallback(Number(timestamp)),
          onInactive: (token) => frames.delete(token),
        },
      );
      if (registration.active) frames.set(registration.token, registration);
      return resources.stageResult(registration.token, {
        onAbort: registration.dispose,
      });
    },
    "browser.animation.cancelAnimationFrame": (frame) => {
      const registration = frames.get(frame);
      if (registration === undefined) cancelFrame(frame);
      else registration.dispose();
      return undefined;
    },
  };
}

function jsNatAsDelay(delay) {
  if (typeof delay !== "bigint" || delay < 0n || delay > 0xffffffffn) {
    throw new Error("timer delay must be a Js Nat in the UInt32 range");
  }
  return Number(delay);
}

function createScheduledCallbackRegistration(
  resources,
  callback,
  { label, schedule, cancel, invoke, onInactive },
) {
  if (typeof callback !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
  let token;
  let active = false;
  let completed = false;
  const registration = {
    get token() {
      return token;
    },
    get active() {
      return active;
    },
    dispose: once(() => {
      const errors = [];
      collectCleanupError(errors, () =>
        resources.removeDisposable(registration),
      );
      collectCleanupError(errors, () => onInactive?.(token));
      if (active) {
        active = false;
        collectCleanupError(errors, () => cancel(token));
      }
      throwCollectedErrors(errors, `${label} cancellation failed`);
    }),
  };
  const run = (...args) => {
    if (completed) return undefined;
    completed = true;
    active = false;
    const errors = [];
    collectCleanupError(errors, () => invoke(callback, ...args));
    collectCleanupError(errors, () => resources.removeDisposable(registration));
    collectCleanupError(errors, () => onInactive?.(token));
    throwCollectedErrors(
      errors,
      `${label} callback or completion cleanup failed`,
    );
    return undefined;
  };
  try {
    token = schedule(run);
    if (!completed) {
      active = true;
      resources.addDisposable(registration, registration.dispose);
    }
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, registration.dispose);
    throwCollectedErrors(
      errors,
      `${label} registration failed during rollback`,
    );
  }
  return registration;
}

function createRecurringCallbackRegistration(
  resources,
  callback,
  { label, schedule, cancel, invoke, onInactive },
) {
  if (typeof callback !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
  let token;
  let active = true;
  let scheduled = false;
  const registration = {
    get token() {
      return token;
    },
    dispose: once(() => {
      active = false;
      const errors = [];
      collectCleanupError(errors, () =>
        resources.removeDisposable(registration),
      );
      collectCleanupError(errors, () => onInactive?.(token));
      if (scheduled) {
        scheduled = false;
        collectCleanupError(errors, () => cancel(token));
      }
      throwCollectedErrors(errors, `${label} cancellation failed`);
    }),
  };
  const run = (...args) => {
    if (!active) return undefined;
    invoke(callback, ...args);
    return undefined;
  };
  try {
    token = schedule(run);
    scheduled = true;
    resources.addDisposable(registration, registration.dispose);
  } catch (error) {
    const errors = [error];
    collectCleanupError(errors, registration.dispose);
    throwCollectedErrors(
      errors,
      `${label} registration failed during rollback`,
    );
  }
  return registration;
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return undefined;
    called = true;
    return fn(...args);
  };
}
