/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import test from "node:test";
import { loadBindingConfig } from "../../scripts/bindings/binding-config.mjs";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

const bindings = createBrowserReactHostBindings({});
const prefix = "react.syntheticEvent.";
const config = await loadBindingConfig(new URL("../../Vir/React.bindings.json", import.meta.url).pathname);

test("base synthetic event relationships match pinned React without DOM event or element claims", () => {
  assert.deepEqual(typeScriptDiagnostics(`
    import type { BaseSyntheticEvent, SyntheticEvent, MouseEvent as ReactMouseEvent } from "react";
    type Selected = SyntheticEvent<EventTarget, Event>;
    type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
    type Assert<T extends true> = T;
    type Native = Assert<Same<Selected["nativeEvent"], Event>>;
    type Target = Assert<Same<Selected["target"], EventTarget>>;
    type Current = Assert<Same<Selected["currentTarget"], EventTarget>>;
    type Prevented = Assert<Same<Selected["defaultPrevented"], boolean>>;
    type Prevent = Assert<Same<Selected["preventDefault"], () => void>>;
    type Stop = Assert<Same<Selected["stopPropagation"], () => void>>;
    declare const click: ReactMouseEvent<HTMLButtonElement>;
    const selected: Selected = click;
    const base: BaseSyntheticEvent<Event, EventTarget, EventTarget> = selected;
    const native: Event = base.nativeEvent;
    const prevented: boolean = selected.defaultPrevented;
    selected.preventDefault();
    selected.stopPropagation();
    // @ts-expect-error the synthetic event is not its underlying DOM Event
    const wrongEvent: Event = selected;
    // @ts-expect-error the base target does not promise an Element
    const wrongTarget: Element = selected.target;
    // @ts-expect-error the base currentTarget does not promise an input element
    const wrongCurrent: HTMLInputElement = selected.currentTarget;
    // @ts-expect-error the base native event does not promise MouseEvent details
    const wrongNative: MouseEvent = selected.nativeEvent;
  `), []);
});

test("synthetic event declarations keep native resource types and dispatch-scoped currentTarget", () => {
  for (const [member, result] of [
    ["nativeEvent", "Lean.Vir.Js Lean.Vir.Browser.Event"],
    ["target", "Lean.Vir.Js Lean.Vir.Browser.EventTarget"],
    ["currentTarget", "Lean.Vir.Js Lean.Vir.Browser.EventTarget"],
    ["defaultPrevented", "Lean.Vir.Js Bool"],
    ["preventDefault", "Unit"],
    ["stopPropagation", "Unit"],
  ]) {
    const operation = config.generation.protocolOperations.find(op => op.target === prefix + member);
    assert.equal(operation.lean, "Lean.Vir.React.SyntheticEvent." + member);
    assert.equal(operation.arguments.length, 1);
    assert.equal(operation.arguments[0].role, "receiver");
    assert.equal(operation.arguments[0].type.lean, "Lean.Vir.Js Lean.Vir.React.SyntheticEvent");
    assert.equal(operation.result.type.lean, result);
    assert.equal(operation.upstreamRelation.member, "React.BaseSyntheticEvent." + member);
  }
});

test("synthetic field providers read each exact field once without snapshots", () => {
  const nativeEvent = new Event("click", { cancelable: true });
  const target = new EventTarget();
  const listenerTarget = new EventTarget();
  let currentTarget = listenerTarget;
  let defaultPrevented = false;
  const reads = [];
  const event = {
    get nativeEvent() { reads.push("nativeEvent"); return nativeEvent; },
    get target() { reads.push("target"); return target; },
    get currentTarget() { reads.push("currentTarget"); return currentTarget; },
    get defaultPrevented() { reads.push("defaultPrevented"); return defaultPrevented; },
  };
  assert.equal(bindings[prefix + "nativeEvent"](event), nativeEvent);
  assert.equal(bindings[prefix + "target"](event), target);
  assert.equal(bindings[prefix + "currentTarget"](event), listenerTarget);
  assert.equal(bindings[prefix + "defaultPrevented"](event), false);
  assert.deepEqual(reads, ["nativeEvent", "target", "currentTarget", "defaultPrevented"]);
  currentTarget = null;
  defaultPrevented = true;
  // Raw runtime observation after dispatch, not use of the callback-scoped Lean type.
  assert.equal(bindings[prefix + "currentTarget"](event), null);
  assert.equal(bindings[prefix + "defaultPrevented"](event), true);
  const failure = new Error("synthetic getter failure");
  for (const member of ["nativeEvent", "target", "currentTarget", "defaultPrevented"])
    assert.throws(() => bindings[prefix + member]({ get [member]() { throw failure; } }),
      caught => caught === failure);
});

test("synthetic methods retain their original receiver, arguments and exceptions", () => {
  const nativeEvent = new Event("click", { cancelable: true });
  const calls = [];
  const event = {
    nativeEvent,
    defaultPrevented: false,
    preventDefault() {
      calls.push(["preventDefault", this, arguments.length]);
      this.nativeEvent.preventDefault();
      this.defaultPrevented = true;
    },
    stopPropagation() {
      calls.push(["stopPropagation", this, arguments.length]);
      this.nativeEvent.stopPropagation();
    },
  };
  assert.equal(bindings[prefix + "preventDefault"](event), undefined);
  assert.equal(bindings[prefix + "defaultPrevented"](event), true);
  assert.equal(nativeEvent.defaultPrevented, true);
  assert.equal(bindings[prefix + "stopPropagation"](event), undefined);
  assert.equal(nativeEvent.cancelBubble, true);
  assert.deepEqual(calls, [["preventDefault", event, 0], ["stopPropagation", event, 0]]);
  const failure = new Error("synthetic method failure");
  for (const member of ["preventDefault", "stopPropagation"])
    assert.throws(() => bindings[prefix + member]({ [member]() { throw failure; } }),
      caught => caught === failure);
});
