/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export function createDomTargetScript({ id, tag = "div", textContent = null }) {
  return `(() => {
    document.querySelector(${JSON.stringify(`#${id}`)})?.remove();
    const target = document.createElement(${JSON.stringify(tag)});
    target.id = ${JSON.stringify(id)};
    if (${JSON.stringify(textContent)} !== null) {
      target.textContent = ${JSON.stringify(textContent)};
    }
    document.body.append(target);
  })()`;
}

export function inputValueHelperScript() {
  return `const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (typeof setter === "function") {
      setter.call(input, value);
    } else {
      input.value = value;
    }
  };`;
}
