import { ensureVirtualElementState } from "../web/src/vir-runtime-node.js";
export { virtualReactTextContent } from "../web/src/react/vir-react-node.js";

export const TAMAGOTCHI_VIRTUAL_DOM_SELECTORS = [
  "#pet-name-input",
  "#pet-name-display",
  "#pet-mood-display",
  "#pet-action-display",
  "#pet-trace-display",
  "#pet-care-display",
  "#pet-turn-display",
  "#pet-summary-display",
  "#pet-device",
  "#pet-art-toggle",
  "#status",
  "[data-action='feed']",
  "[data-action='play']",
  "[data-action='nap']",
  "[data-action='wake']",
  "[data-action='ignore']",
  "#pet-reset-button",
];

export function ensureVirtualElements(state, selectors) {
  for (const selector of selectors) {
    ensureVirtualElementState(state, selector);
  }
}

export function ensureTamagotchiVirtualDom(state) {
  ensureVirtualElements(state, TAMAGOTCHI_VIRTUAL_DOM_SELECTORS);
}
