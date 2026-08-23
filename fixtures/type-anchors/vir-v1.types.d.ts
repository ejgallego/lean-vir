/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/** TypeScript-facing shapes for the first Lean VIR descriptor anchor pass. */
export namespace LeanVir {
  /** JavaScript representation accepted for Lean Nat values. */
  export type Nat = string | number | bigint;

  /** JavaScript representation accepted for Lean Int values. */
  export type Int = string | number | bigint;

  /** JavaScript-owned resource handle carrying a Lean-side phantom marker. */
  export type Js<T> = { readonly __virResource: T };

  /** Synchronous DOM effect marker used by VIR host callbacks. */
  export type DomEffect<T> = T;

  export namespace Browser {
    /** Browser event resource marker. */
    export interface Event {
      readonly __resource: "Event";
    }
  }

  export namespace React {
    /** A single React style object entry. */
    export interface StyleProperty {
      name: string;
      value: string;
    }

    /** Conservative v1 set of React property values. */
    export type PropValue =
      | { kind: "string"; value: string }
      | { kind: "bool"; value: boolean }
      | { kind: "int"; value: LeanVir.Int }
      | { kind: "float"; value: number }
      | { kind: "style"; entries: LeanVir.React.StyleProperty[] }
      | { kind: "classList"; classes: string[] };

    /** A React property transported through the VIR manifest object ABI. */
    export interface Property {
      name: string;
      value: LeanVir.React.PropValue;
    }

    /** DOM-like React event handler backed by a retained Lean closure. */
    export interface EventHandler {
      name: string;
      callback: (event: LeanVir.Js<LeanVir.Browser.Event>) => LeanVir.DomEffect<void>;
    }

    /** Sample callable shape used by the descriptor anchor fixture. */
    export type PropertyIdentity =
      (property: LeanVir.React.Property) => LeanVir.React.Property;
  }
}
