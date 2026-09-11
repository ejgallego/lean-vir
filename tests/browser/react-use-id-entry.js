/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import * as React from "react";
import { createRoot } from "react-dom/client";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { createBrowserHostBindings } from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";

globalThis.runVirReactUseId = async (wasm, pkg) => {
  const hookResults = [];
  const runtime = await createVirRuntime({
    wasmModule: new WebAssembly.Module(new Uint8Array(wasm)),
    irPackageSet: [new Uint8Array(pkg)],
    hostBindings: createBrowserHostBindings({
      reactHostBindings: (lifecycle) => {
        const bindings = createBrowserReactHostBindings(lifecycle);
        return {
          ...bindings,
          "react.useId": () => {
            const id = bindings["react.useId"]();
            hookResults.push(id);
            return id;
          },
        };
      },
    }),
  });
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    return [await probe(false), await probe(true)];
  } finally {
    try {
      runtime.dispose();
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  }

  async function probe(strict) {
    const containers = [document.createElement("div"), document.createElement("div")];
    document.body.append(...containers);
    const roots = containers.map((container) => createRoot(container));
    let renders = 0;
    function Field({ caption }) {
      renders++;
      // React's dispatcher is active while the real interpreter calls useId.
      const start = hookResults.length;
      const node = runtime.call("ReactInput.useIdField", caption);
      check(hookResults.length === start + 2, "Lean must call the actual provider twice");
      const [inputId, hintId] = hookResults.slice(start);
      const [label, input, hint] = node.props.children;
      check(typeof inputId === "string" && typeof hintId === "string" &&
        input.props.id === inputId && label.props.htmlFor === inputId &&
        hint.props.id === hintId && input.props["aria-describedby"] === hintId,
      "React element props must preserve the exact native strings before DOM coercion");
      return node;
    }
    const render = async (suffix) => {
      await React.act(async () => {
        for (const [index, root] of roots.entries()) {
          const keys = index === 0 ? ["first", "second"] : ["third"];
          root.render(React.createElement(
            strict ? React.StrictMode : React.Fragment,
            null,
            ...keys.map((key) => React.createElement(Field, { key, caption: `${key}:${suffix}` })),
          ));
        }
      });
    };
    const inspect = (suffix) => containers.flatMap((container) =>
      [...container.children].map((field) => {
        const label = field.querySelector("label");
        const input = field.querySelector("input");
        const hint = field.querySelector("p");
        check(label && input && hint, "Lean must render the label, input and hint");
        check(label.textContent.endsWith(`:${suffix}`), "changed Lean props must render");
        check(input.id.length > 0 && hint.id.length > 0, "native IDs must be nonempty");
        check(label.htmlFor === input.id && label.control === input &&
          input.labels.length === 1 && input.labels[0] === label,
        "each label must target its own input");
        check(input.getAttribute("aria-describedby") === hint.id &&
          document.getElementById(hint.id) === hint, "each input must target its own hint");
        return [input.id, hint.id];
      })).flat();
    try {
      await render("initial");
      const before = inspect("initial");
      check(before.length === 6 && new Set(before).size === 6,
        "two hook calls in three instances across two roots must have distinct IDs");
      check(renders >= (strict ? 6 : 3), "Strict Mode must replay the Lean render");
      await render("updated");
      const after = inspect("updated");
      check(before.length === after.length && before.every((id, index) => id === after[index]),
        "committed IDs must survive rerenders of the same components and keys");
      return { strict, instances: before.length / 2, distinctIds: new Set(after).size };
    } finally {
      try {
        await React.act(async () => roots.forEach((root) => root.unmount()));
      } finally {
        containers.forEach((container) => container.remove());
      }
    }
  }
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}
