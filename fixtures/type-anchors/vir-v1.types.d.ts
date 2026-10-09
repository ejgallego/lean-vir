/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

/** Descriptor markers, not JavaScript wrappers or replacement host types. */
export namespace LeanVir {
  export namespace Browser {
    export interface Event {
      readonly __resource: "Event";
    }
  }
  export namespace React {
    export interface Root {
      readonly __resource: "Root";
    }
  }
}
