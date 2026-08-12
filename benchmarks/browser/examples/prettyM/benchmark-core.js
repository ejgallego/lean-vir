// @ts-check
// benchmark-core.js — Std.Format differential benchmark engine
// Source: Init/Data/Format/Basic.lean (leanprover/lean4-nightly:nightly-2026-02-23-rev2)
//
// This is a browser-native benchmark core: it owns the compact Format corpus,
// the JavaScript reference implementation, the backend contract, differential
// sampling, phase summaries, scaling studies, and memory/repetition studies.
// It deliberately has no dependency on Reveal or Verso Slides.

"use strict";

/**
 * @typedef {{ type: string, [key: string]: * }} FormatNode
 *
 * @typedef {{
 *   measure: (s: string) => number,
 *   spaceWidth: number,
 *   measureElWidth: (el: Element) => number,
 *   cleanup: () => void
 * }} DOMMeasurer
 *
 * @typedef {{ foundLine: boolean, foundFlattenedHardLine: boolean, space: number }} SpaceResult
 *
 * @typedef {{ type: string, fits: boolean }} Fla
 *
 * @typedef {{ f: FormatNode, indent: number, activeTags: number }} WorkItem
 *
 * @typedef {{ fla: Fla, flb: "allOrNone" | "fill", items: WorkItem[] }} WorkGroup
 *
 * @typedef {{ text: string, tags: number[] }} Segment
 *
 * @typedef {{ cssClass: string, binding?: string }} TokenAnnotation
 *
 * @typedef {{
 *   marshalMs: number,
 *   executeMs: number,
 *   decodeMs: number,
 *   renderMs: number,
 *   totalMs: number,
 *   adapterInputMs?: number,
 *   normalizeMs?: number,
 *   allocateMs?: number,
 *   encodeMs?: number,
 *   inputBytes?: number,
 *   rawObjects?: number,
 *   allocationCalls?: number,
 *   requestBytes?: number,
 *   responseBytes?: number,
 *   formatNodes?: number,
 *   heapBytesBefore?: number,
 *   heapBytesAfter?: number,
 *   batchIterations?: number,
 *   batchWallMs?: number
 * }} PrettyTimings
 *
 * @typedef {{ kind: number, text: string, value: bigint }} PrettyTraceEvent
 *
 * @typedef {{ text: string, events: PrettyTraceEvent[] }} PrettyTrace
 *
 * @typedef {{ segments: Segment[] | null, timings: PrettyTimings, memory?: Record<string, number>, error?: string }} PrettySegmentResult
 *
 * @typedef {{
 *   output: "segments" | "text",
 *   width: "pixels" | "columns"
 * }} PrettyBackendCapabilities
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   capabilities?: PrettyBackendCapabilities,
 *   ready?: Promise<*>,
 *   status?: () => string,
 *   renderSegments?: (
 *     fmtJson: *,
 *     annotations: Record<string, TokenAnnotation>,
 *     pixelWidth: number,
 *     measurer: DOMMeasurer
 *   ) => Segment[] | null,
 *   renderTimed?: (
 *     fmtJson: *,
 *     annotations: Record<string, TokenAnnotation>,
 *     pixelWidth: number,
 *     measurer: DOMMeasurer
 *   ) => PrettySegmentResult
 * }} PrettyBackend
 *
 * @typedef {{
 *   enabled?: boolean,
 *   runtime?: { call: (name: string, ...args: *[]) => * },
 *   jsonExportName?: string,
 *   formatExportName?: string,
 *   formatJsonSegmentsJson?: (fmtJson: string, width: number, indent: number) => string,
 *   formatSegments?: (fmt: *, width: number, indent: number) => *,
 *   ready?: Promise<*>,
 *   status?: string,
 *   assets?: string[],
 *   startupTimings?: Record<string, number>,
 *   warnings?: Record<string, boolean>
 * }} PrettyVirBridge
 *
 * @typedef {{
 *   column: number,
 *   tagStack: number[],
 *   segments: Segment[],
 *   annotations: Record<string, TokenAnnotation>,
 *   pushOutput: (s: string) => void,
 *   pushNewline: (indent: number) => void,
 *   startTag: (t: number) => void,
 *   endTags: (count: number) => void
 * }} RenderContext
 *
 * @typedef {{ fmt: *, annotations: Record<string, TokenAnnotation> }} FormatData
 *
 * @typedef {{ names: string[], ppType?: string | FormatData }} Hypothesis
 *
 * @typedef {{ name?: string, hypotheses: Hypothesis[], goalPrefix: string, ppConclusion?: string | FormatData }} GoalData
 *
 * @typedef {{ html: string, formats: FormatData[] }} GoalsResult
 *
 * @typedef {{ html: string | null, durationMs: number, timings: PrettyTimings }} TimedPrettyResult
 */

/** @type {PrettyBackend[]} */
var prettyBackends = [];

/**
 * Register or replace a pretty-printing candidate. Integration scripts should
 * register synchronously, even when their runtime becomes ready asynchronously,
 * so comparison mode can reserve a stable pane for the candidate.
 * @param {PrettyBackend} backend
 */
function registerPrettyBackend(backend) {
  if (
    !backend ||
    typeof backend.id !== "string" ||
    backend.id.length === 0 ||
    typeof backend.label !== "string" ||
    backend.label.length === 0 ||
    (typeof backend.renderSegments !== "function" &&
      typeof backend.renderTimed !== "function")
  ) {
    throw new TypeError("invalid pretty backend registration");
  }

  var index = prettyBackends.findIndex(function (candidate) {
    return candidate.id === backend.id;
  });
  if (index === -1) {
    prettyBackends.push(backend);
  } else {
    prettyBackends[index] = backend;
  }
}

/**
 * @return {PrettyBackend[]}
 */
function getPrettyBackends() {
  return prettyBackends.slice();
}

/**
 * @param {string} id
 * @return {PrettyBackend | null}
 */
function getPrettyBackend(id) {
  return (
    prettyBackends.find(function (candidate) {
      return candidate.id === id;
    }) || null
  );
}

/**
 * Convert the shared compact Format encoding into the versioned object input
 * shared by the FIR-native and LLVM/Emscripten adapters. The adapters retain
 * ownership of their distinct raw Wasm ABIs.
 * @param {*} formatFactory
 * @param {*} json
 * @return {*}
 */
function compactFormatToAdapterInput(formatFactory, json) {
  if (json === null) return formatFactory.nil();
  if (json === 1) return formatFactory.line();
  if (typeof json === "string") return formatFactory.text(json);
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error("invalid compact Std.Format node");
  }

  switch (json[0]) {
    case 2:
      return formatFactory.align(Boolean(json[1]));
    case 3:
      if (!Number.isSafeInteger(json[1]) || json[1] < 0) {
        throw new Error("invalid Std.Format.nest indentation");
      }
      return formatFactory.nest(
        json[1],
        compactFormatToAdapterInput(formatFactory, json[2]),
      );
    case 4:
      return formatFactory.append(
        compactFormatToAdapterInput(formatFactory, json[1]),
        compactFormatToAdapterInput(formatFactory, json[2]),
      );
    case 5:
    case 6:
      return formatFactory.group(
        compactFormatToAdapterInput(formatFactory, json[1]),
        json[0] === 5 ? "allOrNone" : "fill",
      );
    case 7:
      if (!Number.isSafeInteger(json[1]) || json[1] < 0) {
        throw new Error("invalid Std.Format tag");
      }
      return formatFactory.tag(
        json[1],
        compactFormatToAdapterInput(formatFactory, json[2]),
      );
    default:
      throw new Error("unknown compact Std.Format node tag " + json[0]);
  }
}

/**
 * Convert the shared `PrettyTrace` browser contract into the segment contract
 * used by every comparison backend.
 * @param {PrettyTrace} trace
 * @return {Segment[]}
 */
function prettyTraceToSegments(trace) {
  /** @type {number[]} */
  var tagStack = [];
  /** @type {Segment[]} */
  var segments = [];

  /**
   * @param {bigint} value
   * @param {string} label
   * @return {number}
   */
  function safeNatural(value, label) {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(label + " is outside JavaScript's safe integer range");
    }
    return Number(value);
  }

  trace.events.forEach(function (event) {
    switch (event.kind) {
      case 0:
        if (event.text.length > 0) {
          segments.push({ text: event.text, tags: tagStack.slice() });
        }
        break;
      case 1: {
        var indent = safeNatural(
          event.value,
          "pretty trace newline indentation",
        );
        segments.push({ text: "\n" + " ".repeat(indent), tags: [] });
        break;
      }
      case 2:
        tagStack.push(safeNatural(event.value, "pretty trace tag"));
        break;
      case 3: {
        var count = safeNatural(event.value, "pretty trace endTags count");
        if (count > tagStack.length) {
          throw new Error("pretty trace ends more tags than it started");
        }
        tagStack.length -= count;
        break;
      }
      default:
        throw new Error("pretty trace has unknown event kind " + event.kind);
    }
  });

  if (tagStack.length !== 0) {
    throw new Error("pretty trace leaves tags open");
  }
  var text = segments
    .map(function (segment) {
      return segment.text;
    })
    .join("");
  if (text !== trace.text) {
    throw new Error("pretty trace text projection disagrees with its events");
  }
  return segments;
}

/**
 * Deserialize a compact JSON format node into a tree.
 *
 * Wire format (from Highlighted.lean formatToJson):
 *   null            → nil
 *   "str"           → text(str)
 *   1               → line
 *   [2, bool]       → align(force)
 *   [3, int, sub]   → nest(indent, sub)
 *   [4, a, b]       → append(a, b)
 *   [5, sub]        → group(sub, allOrNone)
 *   [6, sub]        → group(sub, fill)
 *   [7, nat, sub]   → tag(nat, sub)
 * @param {*} json
 * @return {FormatNode}
 */
function deserializeFormat(json) {
  if (json === null || json === undefined) return { type: "nil" };
  if (json === 1) return { type: "line" };
  if (typeof json === "string") return { type: "text", str: json };
  if (!Array.isArray(json) || json.length === 0) return { type: "nil" };
  switch (json[0]) {
    case 2:
      return { type: "align", force: !!json[1] };
    case 3:
      return { type: "nest", indent: json[1], f: deserializeFormat(json[2]) };
    case 4:
      return {
        type: "append",
        f1: deserializeFormat(json[1]),
        f2: deserializeFormat(json[2]),
      };
    case 5:
      return {
        type: "group",
        f: deserializeFormat(json[1]),
        behavior: "allOrNone",
      };
    case 6:
      return { type: "group", f: deserializeFormat(json[1]), behavior: "fill" };
    case 7:
      return { type: "tag", n: json[1], f: deserializeFormat(json[2]) };
    default:
      return { type: "nil" };
  }
}

/**
 * Convert the compact serialized `Std.Format` tree to lean-vir's direct
 * object-ABI representation for `Std.Format`.
 *
 * The object ABI uses Lean's generated constructor field names rather than
 * the compact JSON node names: `nest` stores `{ indent, f }`, `append` stores
 * `{ arg1, arg2 }`, `group` stores `{ arg1, behavior }`, and `tag` stores
 * `{ arg1, arg2 }`. Nat/Int fields cross this ABI as decimal strings.
 * @param {*} json
 * @return {*}
 */
function compactFormatToStdFormat(json) {
  if (json === null) return { kind: "nil" };
  if (typeof json === "string") return { kind: "text", value: json };
  if (json === 1) return { kind: "line" };
  if (!Array.isArray(json)) throw new Error("invalid format node");
  switch (json[0]) {
    case 2:
      return { kind: "align", value: !!json[1] };
    case 3:
      return {
        kind: "nest",
        fields: {
          indent: String(json[1]),
          f: compactFormatToStdFormat(json[2]),
        },
      };
    case 4:
      return {
        kind: "append",
        fields: {
          arg1: compactFormatToStdFormat(json[1]),
          arg2: compactFormatToStdFormat(json[2]),
        },
      };
    case 5:
      return {
        kind: "group",
        fields: {
          arg1: compactFormatToStdFormat(json[1]),
          behavior: "allOrNone",
        },
      };
    case 6:
      return {
        kind: "group",
        fields: { arg1: compactFormatToStdFormat(json[1]), behavior: "fill" },
      };
    case 7:
      return {
        kind: "tag",
        fields: {
          arg1: String(json[1]),
          arg2: compactFormatToStdFormat(json[2]),
        },
      };
    default:
      throw new Error("unknown format node tag " + json[0]);
  }
}

/** Construct an empty space observation. */
function spaceResult(foundLine, foundFlattenedHardLine, space) {
  return {
    foundLine: foundLine || false,
    foundFlattenedHardLine: foundFlattenedHardLine || false,
    space: space || 0,
  };
}

/**
 * @param {number} w
 * @param {SpaceResult} r1
 * @param {(w2: number) => SpaceResult} r2fn
 * @return {SpaceResult}
 */
function merge(w, r1, r2fn) {
  if (r1.space > w || r1.foundLine) return r1;
  var r2 = r2fn(w - r1.space);
  return {
    foundLine: r2.foundLine,
    foundFlattenedHardLine: r2.foundFlattenedHardLine,
    space: r1.space + r2.space,
  };
}

/**
 * Measures how much horizontal space a format takes (in pixels) before a line break.
 * @param {FormatNode} f
 * @param {boolean} flatten
 * @param {number} m
 * @param {number} w
 * @param {DOMMeasurer} measurer
 * @return {SpaceResult}
 */
function spaceUptoLine(f, flatten, m, w, measurer) {
  switch (f.type) {
    case "nil":
      return spaceResult();
    case "line":
      return flatten
        ? spaceResult(false, false, measurer.spaceWidth)
        : spaceResult(true);
    case "align":
      if (flatten && !f.force) return spaceResult();
      if (w < m) return spaceResult(false, false, Math.max(0, m - w));
      return spaceResult(true);
    case "text": {
      var idx = f.str.indexOf("\n");
      if (idx === -1) {
        return spaceResult(false, false, measurer.measure(f.str));
      } else {
        return spaceResult(
          true,
          flatten,
          measurer.measure(f.str.substring(0, idx)),
        );
      }
    }
    case "append":
      return merge(
        w,
        spaceUptoLine(f.f1, flatten, m, w, measurer),
        function (w2) {
          return spaceUptoLine(f.f2, flatten, m, w2, measurer);
        },
      );
    case "nest":
      return spaceUptoLine(
        f.f,
        flatten,
        m - f.indent * measurer.spaceWidth,
        w,
        measurer,
      );
    case "group":
      return spaceUptoLine(f.f, true, m, w, measurer);
    case "tag":
      return spaceUptoLine(f.f, flatten, m, w, measurer);
    default:
      return spaceResult();
  }
}

/**
 * @param {Fla} fla
 * @return {boolean}
 */
function shouldFlatten(fla) {
  return fla.type === "allow" && !!fla.fits;
}

/**
 * Measures space for a list of work groups. Items within each group are stored
 * in reverse order (last element = next to process), so we iterate backwards.
 * @param {WorkGroup[]} groups - groups in reverse order (last = current)
 * @param {number} col
 * @param {number} w
 * @param {DOMMeasurer} measurer
 * @return {SpaceResult}
 */
function spaceUptoLineGroups(groups, col, w, measurer) {
  var result = spaceResult();
  var remainingW = w;

  for (var gi = groups.length - 1; gi >= 0; gi--) {
    var g = groups[gi];
    var flatten = shouldFlatten(g.fla);
    for (var ii = g.items.length - 1; ii >= 0; ii--) {
      var item = g.items[ii];
      var r = spaceUptoLine(
        item.f,
        flatten,
        remainingW + col - item.indent,
        remainingW,
        measurer,
      );
      result = {
        foundLine: r.foundLine,
        foundFlattenedHardLine:
          result.foundFlattenedHardLine || r.foundFlattenedHardLine,
        space: result.space + r.space,
      };
      if (r.space > remainingW || r.foundLine) return result;
      remainingW -= r.space;
    }
  }
  return result;
}

/**
 * Creates a new work group with a flattening decision based on available space.
 * Items and groups are in reverse order (last = next to process).
 * @param {"allOrNone" | "fill"} flb
 * @param {WorkItem[]} items - in reverse order
 * @param {WorkGroup[]} gs - in reverse order
 * @param {number} w
 * @param {RenderContext} ctx
 * @param {DOMMeasurer} measurer
 * @return {WorkGroup[]}
 */
function pushGroup(flb, items, gs, w, ctx, measurer) {
  var k = ctx.column;
  var remaining = w - k;
  var g = {
    fla: { type: "allow", fits: flb === "allOrNone" },
    flb: flb,
    items: items,
  };
  var r = spaceUptoLineGroups([g], k, remaining, measurer);
  var r2 = merge(remaining, r, function (w2) {
    return spaceUptoLineGroups(gs, k, w2, measurer);
  });
  var fits = !r.foundFlattenedHardLine && r2.space <= remaining;
  gs.push({ fla: { type: "allow", fits: fits }, flb: flb, items: items });
  return gs;
}

/**
 * Main layout engine (iterative port of Lean's `be`). Processes work groups,
 * making flattening and line-break decisions, and emits output via the render context.
 *
 * Items within each group are stored in reverse order: the last element is
 * processed next. This allows O(1) pop/push instead of O(n) slice/concat.
 * Groups are also in reverse order (last = current group).
 *
 * @param {number} w
 * @param {WorkGroup[]} groups - in reverse order (last = current)
 * @param {RenderContext} ctx
 * @param {DOMMeasurer} measurer
 */
function be(w, groups, ctx, measurer) {
  while (groups.length > 0) {
    var g = groups[groups.length - 1];
    if (g.items.length === 0) {
      groups.pop();
      continue;
    }
    // Pop current item — O(1). g.items retains the rest.
    // Length was checked above, so pop always returns a value.
    var i = /** @type {WorkItem} */ (g.items.pop());

    switch (i.f.type) {
      case "nil":
        ctx.endTags(i.activeTags);
        break;

      case "tag":
        ctx.startTag(i.f.n);
        // Push replacement (processed next) — O(1)
        g.items.push({
          f: i.f.f,
          indent: i.indent,
          activeTags: i.activeTags + 1,
        });
        break;

      case "append":
        // Push f1 last so it is processed next (before f2) — O(1) each
        g.items.push({ f: i.f.f2, indent: i.indent, activeTags: i.activeTags });
        g.items.push({ f: i.f.f1, indent: i.indent, activeTags: 0 });
        break;

      case "nest":
        g.items.push({
          f: i.f.f,
          indent: i.indent + i.f.indent * measurer.spaceWidth,
          activeTags: i.activeTags,
        });
        break;

      case "text": {
        var s = i.f.str;
        var nlIdx = s.indexOf("\n");
        if (nlIdx === -1) {
          ctx.pushOutput(s);
          ctx.endTags(i.activeTags);
        } else {
          ctx.pushOutput(s.substring(0, nlIdx));
          ctx.pushNewline(Math.max(0, i.indent));
          /** @type {WorkItem} */
          var newTextItem = {
            f: { type: "text", str: s.substring(nlIdx + 1) },
            indent: i.indent,
            activeTags: i.activeTags,
          };
          // After hard line break, re-evaluate flattening
          if (g.fla.type === "disallow") {
            g.items.push(newTextItem);
          } else {
            // Remaining items stay in g.items; add newTextItem
            g.items.push(newTextItem);
            // Steal items from current group, pop it, create new group
            var remainingItems = g.items;
            groups.pop();
            groups = pushGroup(g.flb, remainingItems, groups, w, ctx, measurer);
          }
        }
        break;
      }

      case "line":
        if (g.flb === "allOrNone") {
          if (shouldFlatten(g.fla)) {
            ctx.pushOutput(" ");
          } else {
            ctx.pushNewline(Math.max(0, i.indent));
          }
          ctx.endTags(i.activeTags);
        } else {
          // fill behavior
          if (shouldFlatten(g.fla)) {
            // Try to fit next item too — need a copy since pushGroup mutates
            var savedItems = g.items.slice();
            var savedGroups = groups.slice(0, groups.length - 1);
            var tryGs = pushGroup(
              "fill",
              savedItems,
              savedGroups,
              w - measurer.spaceWidth,
              ctx,
              measurer,
            );
            var nextG = tryGs[tryGs.length - 1];
            if (shouldFlatten(nextG.fla)) {
              ctx.pushOutput(" ");
              ctx.endTags(i.activeTags);
              groups = tryGs;
            } else {
              // Break: use original items
              ctx.pushNewline(Math.max(0, i.indent));
              ctx.endTags(i.activeTags);
              var breakItems = g.items;
              groups.pop();
              groups = pushGroup("fill", breakItems, groups, w, ctx, measurer);
            }
          } else {
            ctx.pushNewline(Math.max(0, i.indent));
            ctx.endTags(i.activeTags);
            var breakItems2 = g.items;
            groups.pop();
            groups = pushGroup("fill", breakItems2, groups, w, ctx, measurer);
          }
        }
        break;

      case "align":
        if (shouldFlatten(g.fla) && !i.f.force) {
          ctx.endTags(i.activeTags);
        } else {
          var k = ctx.column;
          if (k < i.indent) {
            var pad = Math.max(0, i.indent - k);
            ctx.pushOutput(" ".repeat(Math.round(pad / measurer.spaceWidth)));
          } else {
            ctx.pushNewline(Math.max(0, i.indent));
          }
          ctx.endTags(i.activeTags);
        }
        break;

      case "group":
        if (shouldFlatten(g.fla)) {
          // flatten(group f) = flatten f
          g.items.push({
            f: i.f.f,
            indent: i.indent,
            activeTags: i.activeTags,
          });
        } else {
          var groupItem = {
            f: i.f.f,
            indent: i.indent,
            activeTags: i.activeTags,
          };
          groups = pushGroup(
            i.f.behavior,
            [groupItem],
            groups,
            w,
            ctx,
            measurer,
          );
        }
        break;

      default:
        // Unknown format node, skip
        ctx.endTags(i.activeTags);
        break;
    }
  }
}

/**
 * Entry point: pretty-prints a format tree at a given pixel width.
 * @param {FormatNode} f
 * @param {number} w
 * @param {number} indent
 * @param {RenderContext} ctx
 * @param {DOMMeasurer} measurer
 */
function prettyM(f, w, indent, ctx, measurer) {
  indent = indent || 0;
  be(
    w,
    [
      {
        flb: "allOrNone",
        fla: { type: "disallow", fits: false },
        items: [{ f: f, indent: indent, activeTags: 0 }],
      },
    ],
    ctx,
    measurer,
  );
}

/**
 * Creates a rendering context that collects tagged output segments.
 * @param {Record<string, TokenAnnotation>} annotations
 * @param {DOMMeasurer} measurer
 * @return {RenderContext}
 */
function makeRenderContext(annotations, measurer) {
  return {
    column: 0,
    tagStack: [],
    segments: [], // Array of { text, tags }
    annotations: annotations || {},

    pushOutput: function (s) {
      if (s.length === 0) return;
      this.segments.push({ text: s, tags: this.tagStack.slice() });
      this.column += measurer.measure(s);
    },

    pushNewline: function (indent) {
      var spaces = 0;
      if (indent > 0) {
        spaces = Math.round(indent / measurer.spaceWidth);
      }
      this.segments.push({ text: "\n" + " ".repeat(spaces), tags: [] });
      this.column = indent;
    },

    startTag: function (t) {
      this.tagStack.push(t);
    },

    endTags: function (count) {
      for (var j = 0; j < count; j++) {
        this.tagStack.pop();
      }
    },
  };
}

/**
 * Convert a pixel budget to the column budget expected by `Std.Format.prettyM`.
 *
 * This is intentionally approximate. The JavaScript reference can make
 * decisions using exact token widths; Lean's pretty-printer works in character
 * columns. Benchmarks use a deterministic unit-width measurer for fairness.
 * @param {number} pixelWidth
 * @param {DOMMeasurer} measurer
 * @return {number}
 */
function pixelWidthToFormatColumns(pixelWidth, measurer) {
  var spaceWidth = measurer.spaceWidth > 0 ? measurer.spaceWidth : 1;
  var columns = Math.floor(pixelWidth / spaceWidth);
  return Math.max(1, columns);
}

/**
 * @return {PrettyTimings}
 */
function emptyPrettyTimings() {
  return {
    marshalMs: 0,
    executeMs: 0,
    decodeMs: 0,
    renderMs: 0,
    totalMs: 0,
  };
}

/**
 * @param {PrettyTimings} target
 * @param {PrettyTimings} source
 * @return {PrettyTimings}
 */
function addPrettyTimings(target, source) {
  target.marshalMs += source.marshalMs;
  target.executeMs += source.executeMs;
  target.decodeMs += source.decodeMs;
  target.renderMs += source.renderMs;
  target.totalMs += source.totalMs;
  /** @type {(keyof PrettyTimings)[]} */
  var detailKeys = [
    "adapterInputMs",
    "normalizeMs",
    "allocateMs",
    "encodeMs",
    "inputBytes",
    "rawObjects",
    "allocationCalls",
    "requestBytes",
    "responseBytes",
    "formatNodes",
  ];
  detailKeys.forEach(function (key) {
    var value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[key] = (target[key] || 0) + value;
    }
  });
  if (
    typeof source.heapBytesBefore === "number" &&
    Number.isFinite(source.heapBytesBefore)
  ) {
    target.heapBytesBefore =
      typeof target.heapBytesBefore === "number"
        ? Math.min(target.heapBytesBefore, source.heapBytesBefore)
        : source.heapBytesBefore;
  }
  if (
    typeof source.heapBytesAfter === "number" &&
    Number.isFinite(source.heapBytesAfter)
  ) {
    target.heapBytesAfter =
      typeof target.heapBytesAfter === "number"
        ? Math.max(target.heapBytesAfter, source.heapBytesAfter)
        : source.heapBytesAfter;
  }
  return target;
}

/**
 * Convert summed timings from one adaptive batch into per-invocation values.
 * Heap bounds describe the whole batch and therefore remain unscaled.
 * @param {PrettyTimings} timings
 * @param {number} iterations
 * @param {number} wallMs
 * @return {PrettyTimings}
 */
function averagePrettyTimings(timings, iterations, wallMs) {
  var averaged = Object.assign({}, timings);
  /** @type {(keyof PrettyTimings)[]} */
  var averageKeys = [
    "marshalMs",
    "executeMs",
    "decodeMs",
    "renderMs",
    "totalMs",
    "adapterInputMs",
    "normalizeMs",
    "allocateMs",
    "encodeMs",
    "inputBytes",
    "rawObjects",
    "allocationCalls",
    "requestBytes",
    "responseBytes",
    "formatNodes",
  ];
  averageKeys.forEach(function (key) {
    var value = averaged[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      averaged[key] = value / iterations;
    }
  });
  averaged.batchIterations = iterations;
  averaged.batchWallMs = wallMs / iterations;
  return averaged;
}

/**
 * A deterministic character-column measurer for differential comparison.
 * Every backend receives the same budget instead of deriving it independently
 * from its pane's DOM width.
 * @param {number} columns
 * @return {DOMMeasurer}
 */
function createColumnMeasurer(columns) {
  var width = Math.max(1, Math.floor(columns));
  return {
    measure: function (text) {
      return Array.from(text).length;
    },
    spaceWidth: 1,
    measureElWidth: function () {
      return width;
    },
    cleanup: function () {},
  };
}

/**
 * @param {number} started
 * @param {number} marshaled
 * @param {number} executed
 * @param {number} decoded
 * @return {PrettyTimings}
 */
function prettyPhaseTimings(started, marshaled, executed, decoded) {
  return {
    marshalMs: Math.max(0, marshaled - started),
    executeMs: Math.max(0, executed - marshaled),
    decodeMs: Math.max(0, decoded - executed),
    renderMs: 0,
    totalMs: Math.max(0, decoded - started),
  };
}

/**
 * @param {*} value
 * @return {Segment[] | null}
 */
function normalizeVirSegments(value) {
  if (!Array.isArray(value)) return null;
  /** @type {Segment[]} */
  var segments = [];
  for (var i = 0; i < value.length; i++) {
    var seg = value[i];
    if (!seg || typeof seg.text !== "string" || !Array.isArray(seg.tags)) {
      return null;
    }
    /** @type {number[]} */
    var tags = [];
    for (var j = 0; j < seg.tags.length; j++) {
      var tag = Number(seg.tags[j]);
      if (!Number.isInteger(tag) || tag < 0) {
        return null;
      }
      tags.push(tag);
    }
    segments.push({ text: seg.text, tags: tags });
  }
  return segments;
}

/**
 * Build the UTF-8-byte to JavaScript UTF-16 boundary map needed by FIR's
 * direct text/event result. The bounded-runtime ABI uses byte offsets so the
 * same representation remains useful outside JavaScript.
 * @param {string} value
 * @return {Map<number, number>}
 */
function utf8ToUtf16Boundaries(value) {
  var boundaries = new Map();
  var utf8 = 0;
  var utf16 = 0;
  boundaries.set(0, 0);
  for (var scalar of value) {
    var codePoint = scalar.codePointAt(0) || 0;
    utf8 +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    utf16 += scalar.length;
    boundaries.set(utf8, utf16);
  }
  return boundaries;
}

/**
 * Validate FIR's flat `Rendered` result and project it to the semantic segment
 * surface used by the differential sampler. Event kinds are 0=startTag,
 * 1=endTags, and 2=unstyled newline.
 * @param {*} value
 * @return {Segment[] | null}
 */
function normalizePrettyRendered(value) {
  if (
    !value ||
    typeof value.text !== "string" ||
    !Array.isArray(value.events)
  ) {
    return null;
  }

  var boundaries = utf8ToUtf16Boundaries(value.text);
  var totalBytes = 0;
  for (var boundary of boundaries.keys()) totalBytes = boundary;

  /** @type {{ offset: number, kind: number, value: number }[]} */
  var events = [];
  var previousOffset = 0;
  for (var index = 0; index < value.events.length; index++) {
    var raw = value.events[index];
    if (!raw) return null;
    var event = {
      offset: Number(raw.offset),
      kind: Number(raw.kind),
      value: Number(raw.value),
    };
    if (
      !Number.isSafeInteger(event.offset) ||
      !Number.isSafeInteger(event.kind) ||
      !Number.isSafeInteger(event.value) ||
      event.offset < previousOffset ||
      event.offset > totalBytes ||
      event.value < 0 ||
      !boundaries.has(event.offset) ||
      (event.kind !== 0 && event.kind !== 1 && event.kind !== 2)
    ) {
      return null;
    }
    events.push(event);
    previousOffset = event.offset;
  }

  /** @type {number[]} */
  var tagStack = [];
  /** @type {Segment[]} */
  var segments = [];
  var cursorBytes = 0;

  /** @param {number} endBytes @param {number[]} tags */
  function pushThrough(endBytes, tags) {
    var start = boundaries.get(cursorBytes);
    var end = boundaries.get(endBytes);
    if (start === undefined || end === undefined || endBytes < cursorBytes) {
      return false;
    }
    var text = value.text.slice(start, end);
    if (text.length > 0) segments.push({ text: text, tags: tags.slice() });
    cursorBytes = endBytes;
    return true;
  }

  for (var eventIndex = 0; eventIndex < events.length; eventIndex++) {
    var event = events[eventIndex];
    if (!pushThrough(event.offset, tagStack)) return null;
    if (event.kind === 0) {
      tagStack.push(event.value);
    } else if (event.kind === 1) {
      if (event.value > tagStack.length) return null;
      tagStack.length -= event.value;
    } else {
      var newlineEnd = event.offset + event.value + 1;
      var start = boundaries.get(event.offset);
      var end = boundaries.get(newlineEnd);
      if (
        newlineEnd > totalBytes ||
        start === undefined ||
        end === undefined ||
        value.text.slice(start, end) !== "\n" + " ".repeat(event.value) ||
        !pushThrough(newlineEnd, [])
      ) {
        return null;
      }
    }
  }
  if (tagStack.length !== 0 || !pushThrough(totalBytes, tagStack)) return null;
  return segments;
}

/**
 * @param {PrettyVirBridge} bridge
 * @param {string} backend
 * @param {*} error
 */
function warnPrettyVirFailure(bridge, backend, error) {
  var warnings = bridge.warnings || (bridge.warnings = {});
  if (warnings[backend]) return;
  warnings[backend] = true;
  console.warn("VIR pretty-printer backend " + backend + " failed.", error);
}

/**
 * Try rendering through an initialized lean-vir runtime.
 * @param {*} fmtJson
 * @param {number} pixelWidth
 * @param {DOMMeasurer} measurer
 * @return {PrettySegmentResult}
 */
function tryFormatSegmentsWithVirTimed(fmtJson, pixelWidth, measurer) {
  var started = performance.now();
  var marshaled = started;
  var executed = started;
  var bridge = /** @type {Window & { __prettyBenchVir?: PrettyVirBridge }} */ (
    window
  ).__prettyBenchVir;
  if (!bridge || bridge.enabled === false) {
    return { segments: null, timings: emptyPrettyTimings() };
  }
  if (bridge.status && bridge.status !== "ready") {
    return { segments: null, timings: emptyPrettyTimings() };
  }

  var fmtString = JSON.stringify(fmtJson);
  marshaled = performance.now();
  if (typeof fmtString !== "string") {
    return {
      segments: null,
      timings: prettyPhaseTimings(started, marshaled, marshaled, marshaled),
    };
  }

  try {
    var width = pixelWidthToFormatColumns(pixelWidth, measurer);
    var indent = 0;
    var rendered;
    if (typeof bridge.formatJsonSegmentsJson === "function") {
      rendered = bridge.formatJsonSegmentsJson(fmtString, width, indent);
    } else if (bridge.runtime && typeof bridge.runtime.call === "function") {
      rendered = bridge.runtime.call(
        bridge.jsonExportName || "PrettyBench.formatJsonSegmentsJsonForVir",
        fmtString,
        width,
        indent,
      );
    } else {
      return {
        segments: null,
        timings: prettyPhaseTimings(started, marshaled, marshaled, marshaled),
      };
    }
    executed = performance.now();

    var result = typeof rendered === "string" ? JSON.parse(rendered) : rendered;
    if (!result || result.ok !== true) {
      warnPrettyVirFailure(
        bridge,
        "vir",
        result && result.error ? result.error : result,
      );
      var failedAt = performance.now();
      return {
        segments: null,
        timings: prettyPhaseTimings(started, marshaled, executed, failedAt),
      };
    }
    var segments = normalizeVirSegments(result.segments);
    if (segments === null) {
      warnPrettyVirFailure(bridge, "vir", "invalid segment payload");
      var invalidAt = performance.now();
      return {
        segments: null,
        timings: prettyPhaseTimings(started, marshaled, executed, invalidAt),
      };
    }
    var decoded = performance.now();
    return {
      segments: segments,
      timings: prettyPhaseTimings(started, marshaled, executed, decoded),
    };
  } catch (error) {
    warnPrettyVirFailure(bridge, "vir", error);
    var failed = performance.now();
    return {
      segments: null,
      timings: prettyPhaseTimings(
        started,
        marshaled,
        executed === started ? failed : executed,
        failed,
      ),
    };
  }
}

/**
 * Try rendering through lean-vir's direct `Std.Format` object ABI, avoiding
 * JSON serialization at the JavaScript/Lean boundary.
 * @param {*} fmtJson
 * @param {number} pixelWidth
 * @param {DOMMeasurer} measurer
 * @return {PrettySegmentResult}
 */
function tryFormatSegmentsWithVirFormatTimed(fmtJson, pixelWidth, measurer) {
  var started = performance.now();
  var marshaled = started;
  var executed = started;
  var bridge = /** @type {Window & { __prettyBenchVir?: PrettyVirBridge }} */ (
    window
  ).__prettyBenchVir;
  if (!bridge || bridge.enabled === false) {
    return { segments: null, timings: emptyPrettyTimings() };
  }
  if (bridge.status && bridge.status !== "ready") {
    return { segments: null, timings: emptyPrettyTimings() };
  }

  try {
    var width = pixelWidthToFormatColumns(pixelWidth, measurer);
    var indent = 0;
    var fmt = compactFormatToStdFormat(fmtJson);
    marshaled = performance.now();
    var rendered;
    if (typeof bridge.formatSegments === "function") {
      rendered = bridge.formatSegments(fmt, width, indent);
    } else if (bridge.runtime && typeof bridge.runtime.call === "function") {
      rendered = bridge.runtime.call(
        bridge.formatExportName || "PrettyBench.formatSegmentsForVir",
        fmt,
        width,
        indent,
      );
    } else {
      return {
        segments: null,
        timings: prettyPhaseTimings(started, marshaled, marshaled, marshaled),
      };
    }
    executed = performance.now();

    var segments = normalizeVirSegments(rendered);
    if (segments === null) {
      warnPrettyVirFailure(
        bridge,
        "vir-format",
        "invalid Std.Format segment payload",
      );
      var invalidAt = performance.now();
      return {
        segments: null,
        timings: prettyPhaseTimings(started, marshaled, executed, invalidAt),
      };
    }
    var decoded = performance.now();
    return {
      segments: segments,
      timings: prettyPhaseTimings(started, marshaled, executed, decoded),
    };
  } catch (error) {
    warnPrettyVirFailure(bridge, "vir-format", error);
    var failed = performance.now();
    return {
      segments: null,
      timings: prettyPhaseTimings(
        started,
        marshaled,
        executed === started ? failed : executed,
        failed,
      ),
    };
  }
}

/**
 * @param {*} fmtJson
 * @param {Record<string, TokenAnnotation>} annotations
 * @param {number} pixelWidth
 * @param {DOMMeasurer} measurer
 * @return {PrettySegmentResult}
 */
function formatSegmentsWithJsTimed(fmtJson, annotations, pixelWidth, measurer) {
  var started = performance.now();
  var fmt = deserializeFormat(fmtJson);
  var ctx = makeRenderContext(annotations, measurer);
  var marshaled = performance.now();
  prettyM(fmt, pixelWidth, 0, ctx, measurer);
  var executed = performance.now();
  return {
    segments: ctx.segments,
    timings: prettyPhaseTimings(started, marshaled, executed, executed),
  };
}

registerPrettyBackend({
  id: "js",
  label: "JS",
  capabilities: { output: "segments", width: "pixels" },
  status: function () {
    return "ready";
  },
  renderTimed: formatSegmentsWithJsTimed,
});
registerPrettyBackend({
  id: "vir",
  label: "VIR JSON",
  capabilities: { output: "segments", width: "columns" },
  status: function () {
    var bridge = /** @type {Window} */ (window).__prettyBenchVir;
    return bridge && bridge.status ? bridge.status : "unavailable";
  },
  renderTimed: function (fmtJson, _annotations, pixelWidth, measurer) {
    return tryFormatSegmentsWithVirTimed(fmtJson, pixelWidth, measurer);
  },
});
registerPrettyBackend({
  id: "vir-format",
  label: "VIR Format",
  capabilities: { output: "segments", width: "columns" },
  status: function () {
    var bridge = /** @type {Window} */ (window).__prettyBenchVir;
    return bridge && bridge.status ? bridge.status : "unavailable";
  },
  renderTimed: function (fmtJson, _annotations, pixelWidth, measurer) {
    return tryFormatSegmentsWithVirFormatTimed(fmtJson, pixelWidth, measurer);
  },
});

/**
 * Execute one backend and normalize its phase timings.
 * @param {*} fmtJson  - compact array format from Highlighted.lean
 * @param {Record<string, TokenAnnotation>} annotations - tag index → { cssClass, binding }
 * @param {number} pixelWidth - target width in pixels
 * @param {DOMMeasurer} measurer
 * @param {PrettyBackend} backend
 * @return {PrettySegmentResult}
 */
function renderPrettySegmentsTimed(
  fmtJson,
  annotations,
  pixelWidth,
  measurer,
  backend,
) {
  if (typeof backend.renderTimed === "function") {
    return backend.renderTimed(fmtJson, annotations, pixelWidth, measurer);
  }
  if (typeof backend.renderSegments !== "function") {
    return { segments: null, timings: emptyPrettyTimings() };
  }
  var started = performance.now();
  var segments = backend.renderSegments(
    fmtJson,
    annotations,
    pixelWidth,
    measurer,
  );
  var finished = performance.now();
  var timings = emptyPrettyTimings();
  timings.executeMs = Math.max(0, finished - started);
  timings.totalMs = timings.executeMs;
  return { segments: segments, timings: timings };
}

/**
 * Render a format tree to HTML at a given pixel width with one explicit
 * backend. Missing or unavailable backends return `null` instead of falling
 * back to a different candidate.
 * @param {*} fmtJson  - compact array format from Highlighted.lean
 * @param {Record<string, TokenAnnotation>} annotations - tag index → { cssClass, binding }
 * @param {number} pixelWidth - target width in pixels
 * @param {DOMMeasurer} measurer
 * @param {string} backend
 * @return {string | null} HTML string, or null when the backend is unavailable
 */
var prettyDifferentialCorpus = [
  {
    id: "plain-unicode",
    label: "Plain Unicode",
    format: "Lean αβ → Wasm",
  },
  {
    id: "group-break",
    label: "All-or-none group",
    format: [5, [4, "hello", [4, 1, "world"]]],
  },
  {
    id: "nested-list",
    label: "Nested list",
    format: [
      5,
      [
        3,
        1,
        [
          4,
          "[",
          [4, "alpha,", [4, 1, [4, "beta,", [4, 1, [4, "gamma", "]"]]]]],
        ],
      ],
    ],
  },
  {
    id: "fill-paragraph",
    label: "Fill paragraph",
    format: [
      6,
      [
        4,
        "lean",
        [
          4,
          1,
          [
            4,
            "ir",
            [
              4,
              1,
              [4, "runs", [4, 1, [4, "format.pretty", [4, 1, "inside wasm"]]]],
            ],
          ],
        ],
      ],
    ],
  },
  {
    id: "nested-align",
    label: "Nest and align",
    format: [3, 2, [4, ".", [4, [2, false], [4, "a", [4, 1, "b"]]]]],
  },
  {
    id: "embedded-newline",
    label: "Embedded newline",
    format: [4, "αβ", [4, "\n", "γ"]],
  },
  {
    id: "nested-tags",
    label: "Nested tags across break",
    format: [
      7,
      7,
      [
        5,
        [
          4,
          "outer ",
          [4, [7, 8, "inner"], [4, 1, [7, 8, [4, "tagged", [4, 1, "tail"]]]]],
        ],
      ],
    ],
  },
  {
    id: "empty-boundaries",
    label: "Empty boundaries",
    format: [4, null, [4, [7, 3, null], [4, "value", null]]],
  },
  {
    id: "long-token",
    label: "Token wider than budget",
    format: [5, [4, "prefix", [4, 1, "a_very_long_identifier"]]],
  },
];

/**
 * Merge adjacent segments carrying the same tag stack. Backends are allowed to
 * choose different `pushOutput` chunk boundaries; those boundaries do not
 * change either the rendered text or its styling semantics.
 * @param {Segment[]} segments
 * @return {Segment[]}
 */
function canonicalizePrettySegments(segments) {
  /** @type {Segment[]} */
  var canonical = [];
  segments.forEach(function (segment) {
    if (
      !segment ||
      typeof segment.text !== "string" ||
      !Array.isArray(segment.tags)
    ) {
      throw new TypeError("invalid pretty segment");
    }
    if (segment.text.length === 0) return;
    var tags = segment.tags.map(function (tag) {
      var value = Number(tag);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError("invalid pretty segment tag");
      }
      return value;
    });
    var previous = canonical[canonical.length - 1];
    if (
      previous &&
      previous.tags.length === tags.length &&
      previous.tags.every(function (tag, index) {
        return tag === tags[index];
      })
    ) {
      previous.text += segment.text;
    } else {
      canonical.push({ text: segment.text, tags: tags });
    }
  });
  return canonical;
}

/**
 * Measure the observable output work after normalizing backend-specific chunk
 * boundaries. Tag transitions count stack exits and entries, including the
 * final close at the end of the document.
 * @param {Segment[]} segments
 * @return {{ textCodePoints: number, textBytes: number, segments: number, lineBreaks: number, lines: number, maxTagDepth: number, tagTransitions: number }}
 */
function measurePrettyOutput(segments) {
  var encoder = new TextEncoder();
  var text = "";
  var lineBreaks = 0;
  var maxTagDepth = 0;
  var tagTransitions = 0;
  /** @type {number[]} */
  var previousTags = [];
  segments.forEach(function (segment) {
    text += segment.text;
    lineBreaks += (segment.text.match(/\n/g) || []).length;
    maxTagDepth = Math.max(maxTagDepth, segment.tags.length);
    var common = 0;
    while (
      common < previousTags.length &&
      common < segment.tags.length &&
      previousTags[common] === segment.tags[common]
    ) {
      common += 1;
    }
    tagTransitions +=
      previousTags.length - common + segment.tags.length - common;
    previousTags = segment.tags;
  });
  tagTransitions += previousTags.length;
  return {
    textCodePoints: Array.from(text).length,
    textBytes: encoder.encode(text).byteLength,
    segments: segments.length,
    lineBreaks: lineBreaks,
    lines: text.length === 0 ? 0 : lineBreaks + 1,
    maxTagDepth: maxTagDepth,
    tagTransitions: tagTransitions,
  };
}

/**
 * @param {number[]} values
 * @return {{ samples: number, min: number, median: number, p95: number, max: number, mean: number }}
 */
function summarizePrettyValues(values) {
  var sorted = values
    .filter(function (value) {
      return Number.isFinite(value);
    })
    .slice()
    .sort(function (left, right) {
      return left - right;
    });
  if (sorted.length === 0) {
    return { samples: 0, min: 0, median: 0, p95: 0, max: 0, mean: 0 };
  }
  var middle = Math.floor(sorted.length / 2);
  var median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  var p95 =
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    samples: sorted.length,
    min: sorted[0],
    median: median,
    p95: p95,
    max: sorted[sorted.length - 1],
    mean:
      sorted.reduce(function (sum, value) {
        return sum + value;
      }, 0) / sorted.length,
  };
}

/**
 * @param {PrettyTimings[]} timings
 * @return {Record<string, ReturnType<typeof summarizePrettyValues>>}
 */
function summarizePrettyTimings(timings) {
  var phases = ["marshalMs", "executeMs", "decodeMs", "renderMs", "totalMs"];
  /** @type {Record<string, ReturnType<typeof summarizePrettyValues>>} */
  var result = {};
  phases.forEach(function (phase) {
    result[phase] = summarizePrettyValues(
      timings.map(function (sample) {
        return Number(sample[/** @type {keyof PrettyTimings} */ (phase)] || 0);
      }),
    );
  });
  return result;
}

/** Measure the independent dimensions of one compact `Std.Format` value. */
function measureCompactFormat(format) {
  var metrics = {
    formatNodes: 0,
    textCodePoints: 0,
    textBytes: 0,
    maxDepth: 0,
    maxTagDepth: 0,
    lineNodes: 0,
    appendNodes: 0,
    groupNodes: 0,
  };
  var encoder = new TextEncoder();
  var stack = [{ value: format, depth: 1, tagDepth: 0 }];
  while (stack.length > 0) {
    var item = stack.pop();
    if (!item) continue;
    var value = item.value;
    metrics.formatNodes += 1;
    metrics.maxDepth = Math.max(metrics.maxDepth, item.depth);
    metrics.maxTagDepth = Math.max(metrics.maxTagDepth, item.tagDepth);
    if (typeof value === "string") {
      metrics.textCodePoints += Array.from(value).length;
      metrics.textBytes += encoder.encode(value).byteLength;
      continue;
    }
    if (value === null) continue;
    if (value === 1) {
      metrics.lineNodes += 1;
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) {
      throw new TypeError("invalid compact format while measuring input");
    }
    switch (value[0]) {
      case 2:
        break;
      case 3:
        stack.push({
          value: value[2],
          depth: item.depth + 1,
          tagDepth: item.tagDepth,
        });
        break;
      case 4:
        metrics.appendNodes += 1;
        stack.push(
          { value: value[2], depth: item.depth + 1, tagDepth: item.tagDepth },
          { value: value[1], depth: item.depth + 1, tagDepth: item.tagDepth },
        );
        break;
      case 5:
      case 6:
        metrics.groupNodes += 1;
        stack.push({
          value: value[1],
          depth: item.depth + 1,
          tagDepth: item.tagDepth,
        });
        break;
      case 7:
        stack.push({
          value: value[2],
          depth: item.depth + 1,
          tagDepth: item.tagDepth + 1,
        });
        break;
      default:
        throw new TypeError(
          "unknown compact format node while measuring input",
        );
    }
  }
  return metrics;
}

/** @param {*[]} formats @return {*} */
function balancedPrettyAppend(formats) {
  if (formats.length === 0) return null;
  var level = formats.slice();
  while (level.length > 1) {
    var next = [];
    for (var i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? [4, level[i], level[i + 1]] : level[i]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Generate benchmark points that grow one dominant input dimension at a time.
 * @return {{
 *   case: { id: string, label: string, format: *, origin: string, dimension: string, size: number },
 *   width: number,
 *   dimension: string,
 *   dimensionLabel: string,
 *   size: number,
 *   sizeLabel: string,
 *   input: ReturnType<typeof measureCompactFormat>
 * }[]}
 */
function createPrettyScalingScenarios() {
  /** @type {*[]} */
  var scenarios = [];

  /**
   * @param {string} dimension
   * @param {string} dimensionLabel
   * @param {number} size
   * @param {string} sizeLabel
   * @param {*} format
   * @param {number} width
   */
  function add(dimension, dimensionLabel, size, sizeLabel, format, width) {
    scenarios.push({
      case: {
        id: "scale-" + dimension + "-" + size,
        label: dimensionLabel + " · " + sizeLabel,
        format: format,
        origin: "scaling",
        dimension: dimension,
        size: size,
      },
      width: width,
      dimension: dimension,
      dimensionLabel: dimensionLabel,
      size: size,
      sizeLabel: sizeLabel,
      input: measureCompactFormat(format),
    });
  }

  [8, 32, 128, 512, 2048, 8192].forEach(function (size) {
    add(
      "text",
      "Text volume",
      size,
      size + " code points",
      "x".repeat(size),
      80,
    );
  });
  [4, 16, 64, 256, 1024].forEach(function (leaves) {
    var format = balancedPrettyAppend(
      Array.from({ length: leaves }, function () {
        return null;
      }),
    );
    var nodes = measureCompactFormat(format).formatNodes;
    add("nodes", "Format nodes", nodes, nodes + " nodes", format, 80);
  });
  [1, 4, 16, 64, 256].forEach(function (depth) {
    var format = /** @type {*} */ ("x");
    for (var i = 0; i < depth; i++) format = [3, 1, format];
    add("nesting", "Nesting depth", depth, depth + " levels", format, 80);
  });
  [1, 4, 16, 64, 256].forEach(function (breaks) {
    var parts = /** @type {*[]} */ (["word"]);
    for (var i = 0; i < breaks; i++) parts.push(1, "word");
    add(
      "breaks",
      "Break opportunities",
      breaks,
      breaks + " lines",
      [6, balancedPrettyAppend(parts)],
      16,
    );
  });
  [1, 4, 16, 64, 256].forEach(function (depth) {
    var format = /** @type {*} */ ("tagged");
    for (var i = 0; i < depth; i++) format = [7, i + 1, format];
    add("tags", "Tag depth", depth, depth + " tags", format, 80);
  });
  var widthDocument = [
    6,
    balancedPrettyAppend(
      Array.from({ length: 129 }, function (_unused, index) {
        return index === 0 ? "word" : index % 2 === 0 ? "word" : 1;
      }),
    ),
  ];
  [4, 8, 16, 40, 80, 160].forEach(function (width) {
    add(
      "width",
      "Width budget",
      width,
      width + " columns",
      widthDocument,
      width,
    );
  });
  return scenarios;
}

/**
 * Generate compact two-dimensional grids for interactions that cannot be
 * inferred from one-axis slopes.
 * @return {*[]}
 */
function createPrettyInteractionScenarios() {
  /** @type {*[]} */
  var scenarios = [];

  /** @param {string} interaction @param {string} label @param {string} xAxis @param {number} x @param {string} xLabel @param {string} yAxis @param {number} y @param {string} yLabel @param {*} format @param {number} width */
  function add(
    interaction,
    label,
    xAxis,
    x,
    xLabel,
    yAxis,
    y,
    yLabel,
    format,
    width,
  ) {
    scenarios.push({
      case: {
        id: "interaction-" + interaction + "-" + x + "-" + y,
        label: label + " · " + xLabel + " × " + yLabel,
        format: format,
        origin: "interaction",
      },
      width: width,
      input: measureCompactFormat(format),
      interaction: interaction,
      interactionLabel: label,
      xAxis: xAxis,
      x: x,
      xLabel: xLabel,
      yAxis: yAxis,
      y: y,
      yLabel: yLabel,
    });
  }

  [4, 32, 256].forEach(function (breaks) {
    var parts = /** @type {*[]} */ (["word"]);
    for (var index = 0; index < breaks; index++) parts.push(1, "word");
    var format = [6, balancedPrettyAppend(parts)];
    [8, 32, 128].forEach(function (width) {
      add(
        "breaks-width",
        "Breaks × width",
        "Break opportunities",
        breaks,
        breaks + " breaks",
        "Width budget",
        width,
        width + " columns",
        format,
        width,
      );
    });
  });

  [8, 64, 512].forEach(function (leaves) {
    [1, 16, 128].forEach(function (depth) {
      var format = balancedPrettyAppend(
        Array.from({ length: leaves }, function () {
          return "x";
        }),
      );
      for (var index = 0; index < depth; index++) format = [3, 1, format];
      add(
        "nodes-depth",
        "Nodes × depth",
        "Text leaves",
        leaves,
        leaves + " leaves",
        "Nesting depth",
        depth,
        depth + " levels",
        format,
        80,
      );
    });
  });

  [1, 8, 64].forEach(function (depth) {
    [1, 8, 64].forEach(function (chunks) {
      var taggedChunks = Array.from(
        { length: chunks },
        function (_unused, chunk) {
          var format = /** @type {*} */ ("x");
          for (var tag = 0; tag < depth; tag++) {
            format = [7, chunk * depth + tag + 1, format];
          }
          return format;
        },
      );
      var format = balancedPrettyAppend(taggedChunks);
      add(
        "tags-transitions",
        "Tag depth × output transitions",
        "Tag depth",
        depth,
        depth + " tags",
        "Tagged chunks",
        chunks,
        chunks + " chunks",
        format,
        80,
      );
    });
  });

  [32, 512, 8192].forEach(function (textBytes) {
    [0, 8, 64].forEach(function (indent) {
      var lineCount = 16;
      var base = Math.floor(textBytes / lineCount);
      var remainder = textBytes % lineCount;
      /** @type {*[]} */
      var parts = [];
      for (var line = 0; line < lineCount; line++) {
        if (line > 0) parts.push(1);
        parts.push("x".repeat(base + (line < remainder ? 1 : 0)));
      }
      var format = [3, indent, balancedPrettyAppend(parts)];
      add(
        "input-output",
        "Input bytes × output expansion",
        "Input text bytes",
        textBytes,
        textBytes + " B input",
        "Line indentation",
        indent,
        indent + " columns",
        format,
        80,
      );
    });
  });
  return scenarios;
}

/** @param {ArrayBuffer} bytes @return {Promise<string | null>} */
async function prettySha256(bytes) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
  var digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

/**
 * Capture backend startup phases, exact asset footprint/digests, and current
 * Wasm memory without requiring a build-time manifest shared by all pipelines.
 * @param {string[]} [backendIds]
 * @return {Promise<*>}
 */
async function collectPrettyRuntimeProfile(backendIds) {
  var ids = Array.isArray(backendIds)
    ? backendIds
    : getPrettyBackends().map(function (backend) {
        return backend.id;
      });
  var root = /** @type {Window & {
        __prettyBenchVir?: PrettyVirBridge,
        __prettyBenchNative?: *,
        __prettyBenchLlvm?: *,
        __prettyBenchArtifactSetUrl?: string
    }} */ (window);
  var jsScript = Array.from(document.scripts).find(function (script) {
    try {
      var pathname = new URL(script.src).pathname;
      return (
        pathname.endsWith("/lib/pretty.js") ||
        pathname.endsWith("/examples/prettyM/benchmark-core.js")
      );
    } catch (_error) {
      return false;
    }
  });
  var commonAssets = jsScript && jsScript.src ? [jsScript.src] : [];
  var bridges = {
    js: {
      assets: commonAssets,
      startupTimings: null,
    },
    vir: root.__prettyBenchVir,
    "vir-format": root.__prettyBenchVir,
    native: root.__prettyBenchNative,
    llvm: root.__prettyBenchLlvm,
  };
  /** @type {Map<string, Promise<*>>} */
  var assetProfiles = new Map();

  /** @param {string} source */
  function profileAsset(source) {
    var url = new URL(source, document.baseURI).href;
    var cached = assetProfiles.get(url);
    if (cached) return cached;
    var entries = performance.getEntriesByName(url, "resource");
    var timing =
      entries.length > 0
        ? /** @type {PerformanceResourceTiming} */ (entries[0])
        : null;
    var pending = fetch(url, { cache: "force-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.arrayBuffer();
      })
      .then(async function (bytes) {
        var parsed = new URL(url);
        return {
          path: parsed.pathname,
          file: parsed.pathname.split("/").pop() || parsed.pathname,
          byteLength: bytes.byteLength,
          sha256: await prettySha256(bytes),
          wasm: new URL(url).pathname.endsWith(".wasm"),
          load: timing
            ? {
                durationMs: timing.duration,
                startMs: timing.startTime,
                endMs: timing.responseEnd,
                transferBytes: timing.transferSize,
                encodedBytes: timing.encodedBodySize,
                decodedBytes: timing.decodedBodySize,
              }
            : null,
        };
      })
      .catch(function (error) {
        var parsed = new URL(url);
        return {
          path: parsed.pathname,
          file: parsed.pathname.split("/").pop() || parsed.pathname,
          error: error instanceof Error ? error.message : String(error),
        };
      });
    assetProfiles.set(url, pending);
    return pending;
  }

  /** @type {Record<string, *>} */
  var profiles = {};
  for (var idIndex = 0; idIndex < ids.length; idIndex++) {
    var id = ids[idIndex];
    var backend = getPrettyBackend(id);
    var bridge = bridges[/** @type {keyof typeof bridges} */ (id)];
    var assets = Array.from(
      new Set(
        commonAssets.concat(
          bridge && Array.isArray(bridge.assets) ? bridge.assets : [],
        ),
      ),
    );
    var profiledAssets = await Promise.all(assets.map(profileAsset));
    var availableAssets = profiledAssets.filter(function (asset) {
      return typeof asset.byteLength === "number";
    });
    var memoryBytes = null;
    if (
      id === "native" &&
      bridge &&
      bridge.adapter &&
      bridge.adapter.memory instanceof WebAssembly.Memory
    ) {
      memoryBytes = bridge.adapter.memory.buffer.byteLength;
    } else if (
      id === "llvm" &&
      bridge &&
      bridge.adapter &&
      bridge.adapter.loaded &&
      bridge.adapter.loaded.module &&
      bridge.adapter.loaded.module.HEAPU8
    ) {
      memoryBytes = bridge.adapter.loaded.module.HEAPU8.byteLength;
    } else if (id === "vir" || id === "vir-format") {
      var runtime = bridge && bridge.runtime;
      var memory =
        runtime && runtime.memory instanceof WebAssembly.Memory
          ? runtime.memory
          : runtime &&
              runtime.exports &&
              runtime.exports.memory instanceof WebAssembly.Memory
            ? runtime.exports.memory
            : runtime &&
                runtime.instance &&
                runtime.instance.exports &&
                runtime.instance.exports.memory instanceof WebAssembly.Memory
              ? runtime.instance.exports.memory
              : null;
      if (memory) memoryBytes = memory.buffer.byteLength;
    }
    var startup =
      bridge && bridge.startupTimings ? bridge.startupTimings : null;
    var startupMs =
      startup && typeof startup.bridgeTotalMs === "number"
        ? startup.bridgeTotalMs
        : startup && typeof startup.totalMs === "number"
          ? startup.totalMs
          : null;
    var loadedAssets = availableAssets.filter(function (asset) {
      return asset.load;
    });
    var resourceLoadMs =
      loadedAssets.length > 0
        ? Math.max.apply(
            null,
            loadedAssets.map(function (asset) {
              return asset.load.endMs;
            }),
          ) -
          Math.min.apply(
            null,
            loadedAssets.map(function (asset) {
              return asset.load.startMs;
            }),
          )
        : null;
    if (id === "js" && startupMs === null) startupMs = resourceLoadMs;
    var provenance = null;
    if (id === "native" && bridge && bridge.build) {
      provenance = {
        pipeline: "lean-lcnf-to-fir-native-wasm",
        sourceCommit: bridge.build.sourceCommit,
        artifact: bridge.build.artifact,
        functionImports: bridge.build.functionImports,
      };
    } else if (
      (id === "vir" || id === "vir-format") &&
      bridge &&
      bridge.runtime
    ) {
      provenance = {
        pipeline: "lean-vir",
        packageInfo: bridge.runtime.packageInfo,
        packageMetadata: bridge.runtime.packageMetadata,
        interfaceArtifact:
          bridge.runtime.interfaceManifest &&
          bridge.runtime.interfaceManifest.artifact,
      };
    } else if (id === "llvm" && bridge && bridge.manifest) {
      provenance = {
        pipeline: bridge.manifest.pipeline,
        toolchain: bridge.manifest.toolchain,
        artifacts: bridge.manifest.artifacts,
        runtime: bridge.manifest.runtime,
      };
    }
    profiles[id] = {
      id: id,
      label: backend ? backend.label : id,
      status:
        backend && typeof backend.status === "function"
          ? backend.status()
          : "ready",
      startup: startup,
      startupMs: startupMs,
      resourceLoadMs: resourceLoadMs,
      assetBytes: availableAssets.reduce(function (sum, asset) {
        return sum + asset.byteLength;
      }, 0),
      wasmBytes: availableAssets.reduce(function (sum, asset) {
        return sum + (asset.wasm ? asset.byteLength : 0);
      }, 0),
      memoryBytes: memoryBytes,
      assets: profiledAssets,
      provenance: provenance,
    };
  }
  var sharedAssets = await Promise.all(commonAssets.map(profileAsset));
  var artifactSet = null;
  if (root.__prettyBenchArtifactSetUrl) {
    var artifactSetAsset = await profileAsset(root.__prettyBenchArtifactSetUrl);
    var artifactSetManifest = await fetch(root.__prettyBenchArtifactSetUrl, {
      cache: "force-cache",
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .catch(function (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      });
    artifactSet = {
      asset: artifactSetAsset,
      manifest: artifactSetManifest,
    };
  }
  return {
    capturedAt: new Date().toISOString(),
    crossOriginIsolated: globalThis.crossOriginIsolated,
    userAgent: navigator.userAgent,
    sharedAssetBytes: sharedAssets.reduce(function (sum, asset) {
      return (
        sum + (typeof asset.byteLength === "number" ? asset.byteLength : 0)
      );
    }, 0),
    sharedAssets: sharedAssets,
    artifactSet: artifactSet,
    backends: profiles,
  };
}

/**
 * Read memory counters without fetching or hashing artifacts. `committedBytes`
 * is the current linear-memory capacity. `residentBytes` is only available
 * where the adapter exposes a live allocation frontier.
 * @param {string[]} [backendIds]
 * @return {{ capturedAt: string, backends: Record<string, *> }}
 */
function collectPrettyMemorySnapshot(backendIds) {
  var ids = Array.isArray(backendIds)
    ? backendIds
    : getPrettyBackends().map(function (backend) {
        return backend.id;
      });
  var root = /** @type {Window & {
        __prettyBenchVir?: *,
        __prettyBenchNative?: *,
        __prettyBenchLlvm?: *
    }} */ (window);
  /** @type {Record<string, *>} */
  var result = {};
  ids.forEach(function (id) {
    var backend = getPrettyBackend(id);
    var committedBytes = null;
    var residentBytes = null;
    var sharedMemoryGroup = null;
    var details = null;
    if (id === "native") {
      var nativeBridge = root.__prettyBenchNative;
      if (
        nativeBridge &&
        nativeBridge.adapter &&
        nativeBridge.adapter.memory instanceof WebAssembly.Memory
      ) {
        committedBytes = nativeBridge.adapter.memory.buffer.byteLength;
      }
      var nativeMemory = nativeBridge && nativeBridge.lastMemory;
      if (
        nativeMemory &&
        typeof nativeMemory.frontierAfterDecode === "number"
      ) {
        residentBytes = nativeMemory.frontierAfterDecode;
        details = nativeMemory;
      } else if (
        nativeBridge &&
        nativeBridge.adapter &&
        typeof nativeBridge.adapter.frontier === "function"
      ) {
        residentBytes = Number(nativeBridge.adapter.frontier()) >>> 0;
      }
    } else if (id === "llvm") {
      var llvmBridge = root.__prettyBenchLlvm;
      if (
        llvmBridge &&
        llvmBridge.adapter &&
        llvmBridge.adapter.loaded &&
        llvmBridge.adapter.loaded.module &&
        llvmBridge.adapter.loaded.module.HEAPU8
      ) {
        committedBytes = llvmBridge.adapter.loaded.module.HEAPU8.byteLength;
      }
      details = llvmBridge && llvmBridge.lastMemory;
    } else if (id === "vir" || id === "vir-format") {
      var virBridge = root.__prettyBenchVir;
      var runtime = virBridge && virBridge.runtime;
      var memory =
        runtime && runtime.memory instanceof WebAssembly.Memory
          ? runtime.memory
          : runtime &&
              runtime.exports &&
              runtime.exports.memory instanceof WebAssembly.Memory
            ? runtime.exports.memory
            : runtime &&
                runtime.instance &&
                runtime.instance.exports &&
                runtime.instance.exports.memory instanceof WebAssembly.Memory
              ? runtime.instance.exports.memory
              : null;
      if (memory) committedBytes = memory.buffer.byteLength;
      sharedMemoryGroup = "vir-runtime";
    }
    result[id] = {
      id: id,
      label: backend ? backend.label : id,
      status:
        backend && typeof backend.status === "function"
          ? backend.status()
          : "ready",
      committedBytes: committedBytes,
      residentBytes: residentBytes,
      sharedMemoryGroup: sharedMemoryGroup,
      details: details,
    };
  });
  return { capturedAt: new Date().toISOString(), backends: result };
}

/**
 * Interleave differential candidates, retain phase samples, and compare their
 * canonical outputs. Domain adapters supply invocation and report assembly;
 * this loop deliberately knows nothing about `Std.Format` or scaling axes.
 *
 * @param {{
 *   candidates: *[],
 *   scenarios: *[],
 *   warmup: number,
 *   samples: number,
 *   batchTargetMs: number,
 *   maxBatchIterations: number,
 *   batchMemoryBudgetBytes: number,
 *   prepareScenario?: (scenario: *) => *,
 *   invoke: (scenario: *, candidate: *, context: *) => { ok: boolean, value: *, timings: PrettyTimings, memory?: Record<string, number>, error?: string },
 *   canonicalize: (value: *) => *,
 *   measureOutput: (value: *) => *,
 *   residentBytes?: (observation: *) => number | null,
 *   buildScenario: (scenario: *, index: number, results: Record<string, *>, firstOutput: *, parity: boolean) => *,
 *   buildProgress?: (scenario: *, completed: number, total: number) => *,
 *   onScenario?: (scenario: *) => void,
 *   onProgress?: (progress: *) => void
 * }} options
 * @return {Promise<{ candidateStates: *[], scenarios: *[] }>}
 */
async function runDifferentialSamples(options) {
  var candidates = options.candidates;
  var scenarioInputs = options.scenarios;
  var candidateStates = candidates.map(function (candidate) {
    return {
      id: candidate.id,
      label: candidate.label,
      status:
        typeof candidate.status === "function" ? candidate.status() : "ready",
      timings: /** @type {PrettyTimings[]} */ ([]),
      invocations: 0,
    };
  });
  var readyCandidates = candidates.filter(function (_candidate, index) {
    return candidateStates[index].status === "ready";
  });
  var total = scenarioInputs.length;
  var completed = 0;
  var scenarios = [];

  for (
    var scenarioIndex = 0;
    scenarioIndex < scenarioInputs.length;
    scenarioIndex++
  ) {
    var scenarioInput = scenarioInputs[scenarioIndex];
    var scenarioContext = options.prepareScenario
      ? options.prepareScenario(scenarioInput)
      : null;
    /** @type {Record<string, *>} */
    var candidateResults = {};
    readyCandidates.forEach(function (candidate) {
      candidateResults[candidate.id] = {
        value: null,
        signature: null,
        metrics: null,
        stable: true,
        errors: [],
        timings: [],
        memorySamples: [],
        batchIterations: 1,
        batchResidentBytesPerCall: null,
        batchLimitReason: null,
        invocations: 0,
        summary: null,
      };
    });

    /**
     * @param {*} result
     * @param {{ ok: boolean, value: *, timings: PrettyTimings, memory?: Record<string, number>, error?: string }} observation
     * @return {boolean}
     */
    function observe(result, observation) {
      if (!observation.ok) {
        result.stable = false;
        if (observation.error && !result.errors.includes(observation.error)) {
          result.errors.push(observation.error);
        }
        return false;
      }
      var value = options.canonicalize(observation.value);
      var signature = JSON.stringify(value);
      if (result.signature !== null && result.signature !== signature) {
        result.stable = false;
      }
      result.value = value;
      result.signature = signature;
      result.metrics = options.measureOutput(value);
      return true;
    }

    if (options.batchTargetMs > 0) {
      readyCandidates.forEach(function (candidate) {
        var calibrationStarted = performance.now();
        var calibration = options.invoke(
          scenarioInput,
          candidate,
          scenarioContext,
        );
        var calibrationWallMs = performance.now() - calibrationStarted;
        observe(candidateResults[candidate.id], calibration);
        var observedMs = Math.max(
          0.01,
          calibrationWallMs,
          Number(calibration.timings.totalMs || 0),
        );
        var requestedIterations = Math.max(
          1,
          Math.min(
            options.maxBatchIterations,
            Math.ceil(options.batchTargetMs / observedMs),
          ),
        );
        var result = candidateResults[candidate.id];
        var residentDelta = options.residentBytes
          ? options.residentBytes(calibration)
          : null;
        result.batchResidentBytesPerCall = residentDelta;
        if (
          residentDelta !== null &&
          residentDelta > 0 &&
          options.batchMemoryBudgetBytes > 0
        ) {
          var perScenarioBudget =
            options.batchMemoryBudgetBytes / scenarioInputs.length;
          var memoryLimitedIterations = Math.max(
            1,
            Math.floor(
              perScenarioBudget /
                residentDelta /
                Math.max(1, options.warmup + options.samples),
            ),
          );
          result.batchIterations = Math.min(
            requestedIterations,
            memoryLimitedIterations,
          );
          if (result.batchIterations < requestedIterations) {
            result.batchLimitReason = "resident-memory-budget";
          }
        } else {
          result.batchIterations = requestedIterations;
        }
      });
    }

    for (var round = -options.warmup; round < options.samples; round++) {
      for (var offset = 0; offset < readyCandidates.length; offset++) {
        var candidate =
          readyCandidates[
            (offset + Math.max(0, round)) % readyCandidates.length
          ];
        var result = candidateResults[candidate.id];
        var iterations = result.batchIterations;
        var summedTimings = emptyPrettyTimings();
        var measuredIterations = 0;
        /** @type {Record<string, number> | null} */
        var lastMemory = null;
        var batchStarted = performance.now();
        for (var iteration = 0; iteration < iterations; iteration++) {
          var observation = options.invoke(
            scenarioInput,
            candidate,
            scenarioContext,
          );
          if (!observe(result, observation)) continue;
          addPrettyTimings(summedTimings, observation.timings);
          measuredIterations += 1;
          if (observation.memory) lastMemory = observation.memory;
        }
        var batchWallMs = performance.now() - batchStarted;
        if (round >= 0) {
          var averaged = averagePrettyTimings(
            summedTimings,
            Math.max(1, measuredIterations),
            batchWallMs,
          );
          result.timings.push(averaged);
          result.invocations += iterations;
          if (lastMemory) result.memorySamples.push(lastMemory);
          var state = candidateStates.find(function (item) {
            return item.id === candidate.id;
          });
          if (state) {
            state.timings.push(averaged);
            state.invocations += iterations;
          }
        }
      }
    }

    Object.keys(candidateResults).forEach(function (id) {
      candidateResults[id].summary = summarizePrettyTimings(
        candidateResults[id].timings,
      );
    });
    var signatures = Object.keys(candidateResults)
      .map(function (id) {
        return candidateResults[id].signature;
      })
      .filter(function (signature) {
        return signature !== null;
      });
    var parity =
      readyCandidates.length === candidates.length &&
      signatures.length === candidates.length &&
      signatures.every(function (signature) {
        return signature === signatures[0];
      }) &&
      Object.keys(candidateResults).every(function (id) {
        return candidateResults[id].stable;
      });
    var firstOutput =
      readyCandidates.length > 0 && candidateResults[readyCandidates[0].id]
        ? candidateResults[readyCandidates[0].id].metrics
        : null;
    var scenarioReport = options.buildScenario(
      scenarioInput,
      scenarioIndex,
      candidateResults,
      firstOutput,
      parity,
    );
    scenarios.push(scenarioReport);
    if (typeof options.onScenario === "function")
      options.onScenario(scenarioReport);
    completed += 1;
    if (typeof options.onProgress === "function") {
      options.onProgress(
        options.buildProgress
          ? options.buildProgress(scenarioInput, completed, total)
          : { completed: completed, total: total },
      );
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  return { candidateStates: candidateStates, scenarios: scenarios };
}

/**
 * Compare the registered pretty-printer backends over a representative corpus.
 * Runs are interleaved and their starting backend is rotated to reduce ordering
 * bias. Warm-up observations are excluded from the returned statistics.
 *
 * @param {{
 *   backendIds?: string[],
 *   cases?: { id: string, label?: string, format: *, origin?: string }[],
 *   widths?: number[],
 *   scenarios?: { case: { id: string, label?: string, format: *, origin?: string }, width: number, [key: string]: * }[],
 *   warmup?: number,
 *   samples?: number,
 *   batchTargetMs?: number,
 *   maxBatchIterations?: number,
 *   batchMemoryBudgetBytes?: number,
 *   profile?: boolean,
 *   onBenchmarkStart?: (state: { backendIds: string[], memory: ReturnType<typeof collectPrettyMemorySnapshot> }) => void,
 *   onScenario?: (scenario: *) => void,
 *   onProgress?: (progress: { completed: number, total: number, caseId: string, width: number, [key: string]: * }) => void
 * }} [options]
 * @return {Promise<*>}
 */
async function runPrettyDifferentialCorpus(options) {
  var reportStartedAt = new Date().toISOString();
  var reportStarted = performance.now();
  var settings = options || {};
  var requestedIds = Array.isArray(settings.backendIds)
    ? settings.backendIds
    : getPrettyBackends().map(function (backend) {
        return backend.id;
      });
  var backends = requestedIds.map(function (id) {
    var backend = getPrettyBackend(id);
    if (!backend) throw new Error("unknown pretty backend " + id);
    return backend;
  });
  var cases = Array.isArray(settings.cases)
    ? settings.cases
    : prettyDifferentialCorpus.slice();
  var widths = (
    Array.isArray(settings.widths) ? settings.widths : [4, 8, 16, 40, 80]
  ).map(function (width) {
    var value = Number(width);
    if (!Number.isSafeInteger(value) || value < 1 || value > 10000) {
      throw new TypeError("invalid differential corpus width");
    }
    return value;
  });
  var warmup = settings.warmup === undefined ? 2 : Number(settings.warmup);
  var samples = settings.samples === undefined ? 9 : Number(settings.samples);
  var batchTargetMs =
    settings.batchTargetMs === undefined ? 0 : Number(settings.batchTargetMs);
  var maxBatchIterations =
    settings.maxBatchIterations === undefined
      ? 512
      : Number(settings.maxBatchIterations);
  var batchMemoryBudgetBytes =
    settings.batchMemoryBudgetBytes === undefined
      ? 64 * 1024 * 1024
      : Number(settings.batchMemoryBudgetBytes);
  if (!Number.isSafeInteger(warmup) || warmup < 0 || warmup > 100) {
    throw new TypeError("invalid differential corpus warm-up count");
  }
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1000) {
    throw new TypeError("invalid differential corpus sample count");
  }
  if (
    !Number.isFinite(batchTargetMs) ||
    batchTargetMs < 0 ||
    batchTargetMs > 1000
  ) {
    throw new TypeError("invalid differential batch target");
  }
  if (
    !Number.isSafeInteger(maxBatchIterations) ||
    maxBatchIterations < 1 ||
    maxBatchIterations > 100000
  ) {
    throw new TypeError("invalid differential maximum batch size");
  }
  if (
    !Number.isFinite(batchMemoryBudgetBytes) ||
    batchMemoryBudgetBytes < 0 ||
    batchMemoryBudgetBytes > 4 * 1024 * 1024 * 1024
  ) {
    throw new TypeError("invalid differential batch memory budget");
  }
  /** @type {*[]} */
  var scenarioInputs = Array.isArray(settings.scenarios)
    ? settings.scenarios.slice()
    : cases.flatMap(function (corpusCase) {
        return widths.map(function (width) {
          return { case: corpusCase, width: width };
        });
      });
  scenarioInputs.forEach(function (scenario) {
    if (!scenario || !scenario.case || typeof scenario.case.id !== "string") {
      throw new TypeError("invalid differential benchmark scenario");
    }
    var width = Number(scenario.width);
    if (!Number.isSafeInteger(width) || width < 1 || width > 10000) {
      throw new TypeError("invalid differential scenario width");
    }
    scenario.width = width;
  });

  await Promise.all(
    backends.map(function (backend) {
      return backend.ready && typeof backend.ready.then === "function"
        ? Promise.resolve(backend.ready).catch(function () {
            return null;
          })
        : Promise.resolve();
    }),
  );
  var backendsReady = performance.now();
  var runtimeProfileBefore =
    settings.profile === false
      ? null
      : await collectPrettyRuntimeProfile(requestedIds);
  if (typeof settings.onBenchmarkStart === "function") {
    settings.onBenchmarkStart({
      backendIds: requestedIds.slice(),
      memory: collectPrettyMemorySnapshot(requestedIds),
    });
  }
  var benchmarkStarted = performance.now();

  var sampled = await runDifferentialSamples({
    candidates: backends,
    scenarios: scenarioInputs,
    warmup: warmup,
    samples: samples,
    batchTargetMs: batchTargetMs,
    maxBatchIterations: maxBatchIterations,
    batchMemoryBudgetBytes: batchMemoryBudgetBytes,
    prepareScenario: function (scenario) {
      return createColumnMeasurer(scenario.width);
    },
    invoke: function (scenario, backend, measurer) {
      var rendered = renderPrettySegmentsTimed(
        scenario.case.format,
        {},
        scenario.width,
        measurer,
        backend,
      );
      return {
        ok: rendered.segments !== null,
        value: rendered.segments,
        timings: rendered.timings,
        memory: rendered.memory,
        error: rendered.error,
      };
    },
    canonicalize: canonicalizePrettySegments,
    measureOutput: measurePrettyOutput,
    residentBytes: function (observation) {
      var memory = observation.memory;
      return memory &&
        typeof memory.frontierBefore === "number" &&
        typeof memory.frontierAfterDecode === "number"
        ? memory.frontierAfterDecode - memory.frontierBefore
        : null;
    },
    buildScenario: function (
      scenarioInput,
      scenarioIndex,
      candidateResults,
      firstOutput,
      parity,
    ) {
      var corpusCase = scenarioInput.case;
      /** @type {Record<string, *>} */
      var backendResults = {};
      Object.keys(candidateResults).forEach(function (id) {
        var result = candidateResults[id];
        backendResults[id] = {
          segments: result.value,
          signature: result.signature,
          output: result.metrics,
          stable: result.stable,
          errors: result.errors,
          timings: result.timings,
          memorySamples: result.memorySamples,
          batchIterations: result.batchIterations,
          batchResidentBytesPerCall: result.batchResidentBytesPerCall,
          batchLimitReason: result.batchLimitReason,
          invocations: result.invocations,
          summary: result.summary,
        };
      });
      return {
        caseId: corpusCase.id,
        label: corpusCase.label || corpusCase.id,
        origin: corpusCase.origin || "synthetic",
        width: scenarioInput.width,
        input: scenarioInput.input || measureCompactFormat(corpusCase.format),
        dimension: scenarioInput.dimension || corpusCase.dimension || null,
        dimensionLabel: scenarioInput.dimensionLabel || null,
        interaction: scenarioInput.interaction || null,
        interactionLabel: scenarioInput.interactionLabel || null,
        xAxis: scenarioInput.xAxis || null,
        x: typeof scenarioInput.x === "number" ? scenarioInput.x : null,
        xLabel: scenarioInput.xLabel || null,
        yAxis: scenarioInput.yAxis || null,
        y: typeof scenarioInput.y === "number" ? scenarioInput.y : null,
        yLabel: scenarioInput.yLabel || null,
        size:
          typeof scenarioInput.size === "number"
            ? scenarioInput.size
            : typeof corpusCase.size === "number"
              ? corpusCase.size
              : null,
        sizeLabel: scenarioInput.sizeLabel || null,
        repeatRound:
          typeof scenarioInput.repeatRound === "number"
            ? scenarioInput.repeatRound
            : null,
        sequenceIndex:
          typeof scenarioInput.sequenceIndex === "number"
            ? scenarioInput.sequenceIndex
            : scenarioIndex,
        output: firstOutput,
        parity: parity,
        backends: backendResults,
      };
    },
    buildProgress: function (scenarioInput, completed, total) {
      return {
        completed: completed,
        total: total,
        caseId: scenarioInput.case.id,
        width: scenarioInput.width,
        dimension: scenarioInput.dimension || scenarioInput.case.dimension,
        size: scenarioInput.size,
      };
    },
    onScenario: settings.onScenario,
    onProgress: settings.onProgress,
  });
  var backendStates = sampled.candidateStates;
  var scenarios = sampled.scenarios;

  /** @type {Record<string, *>} */
  var summaries = {};
  backendStates.forEach(function (state) {
    summaries[state.id] = {
      id: state.id,
      label: state.label,
      status: state.status,
      invocations: state.invocations,
      timing: summarizePrettyTimings(state.timings),
    };
  });
  var mismatches = scenarios.filter(function (scenario) {
    return !scenario.parity;
  });
  var unavailable = backendStates
    .filter(function (state) {
      return state.status !== "ready";
    })
    .map(function (state) {
      return { id: state.id, label: state.label, status: state.status };
    });
  var benchmarkFinished = performance.now();
  var runtimeProfile =
    settings.profile === false
      ? null
      : await collectPrettyRuntimeProfile(requestedIds);
  var reportFinished = performance.now();
  /** @type {*[]} */
  var reportCases = [];
  var reportCaseIds = new Set();
  scenarioInputs.forEach(function (scenario) {
    if (reportCaseIds.has(scenario.case.id)) return;
    reportCaseIds.add(scenario.case.id);
    reportCases.push({
      id: scenario.case.id,
      label: scenario.case.label || scenario.case.id,
      origin: scenario.case.origin || "synthetic",
    });
  });
  return {
    schemaVersion: 2,
    kind: "differential",
    startedAt: reportStartedAt,
    generatedAt: new Date().toISOString(),
    backendReadyWaitMs: backendsReady - reportStarted,
    profileBeforeMs: benchmarkStarted - backendsReady,
    benchmarkMs: benchmarkFinished - benchmarkStarted,
    profileMs: reportFinished - benchmarkFinished,
    durationMs: reportFinished - reportStarted,
    warmup: warmup,
    samples: samples,
    batchTargetMs: batchTargetMs,
    maxBatchIterations: maxBatchIterations,
    batchMemoryBudgetBytes: batchMemoryBudgetBytes,
    widths: Array.from(
      new Set(
        scenarioInputs.map(function (scenario) {
          return scenario.width;
        }),
      ),
    ),
    cases: reportCases,
    backendIds: requestedIds,
    scenarioCount: scenarios.length,
    parityCount: scenarios.length - mismatches.length,
    passed: mismatches.length === 0 && unavailable.length === 0,
    unavailable: unavailable,
    mismatches: mismatches.map(function (scenario) {
      /** @type {Record<string, string[]>} */
      var backendErrors = {};
      requestedIds.forEach(function (id) {
        if (scenario.backends[id] && scenario.backends[id].errors.length > 0) {
          backendErrors[id] = scenario.backends[id].errors;
        }
      });
      var mismatch = /** @type {*} */ ({
        caseId: scenario.caseId,
        label: scenario.label,
        width: scenario.width,
      });
      if (Object.keys(backendErrors).length > 0)
        mismatch.backendErrors = backendErrors;
      return mismatch;
    }),
    summaries: summaries,
    scenarios: scenarios,
    runtimeProfileBefore: runtimeProfileBefore,
    runtimeProfile: runtimeProfile,
  };
}

/**
 * Canonicalize object key order so JSON implementations are compared by value,
 * not by the incidental ordering chosen by their object representation.
 * @param {*} value
 * @return {*}
 */
function summarizePrettyScalingTrend(points, backendId, phase) {
  /** @type {{ size: number, time: number }[]} */
  var samples = points
    .map(function (/** @type {*} */ point) {
      var backend = point.backends[backendId];
      var distribution = backend && backend.summary[phase];
      return {
        size: Number(point.size),
        time: distribution ? Number(distribution.median) : 0,
      };
    })
    .filter(function (sample) {
      return sample.size > 0 && sample.time > 0;
    });
  var slope = null;
  if (samples.length >= 2) {
    var xs = samples.map(function (sample) {
      return Math.log(sample.size);
    });
    var ys = samples.map(function (sample) {
      return Math.log(sample.time);
    });
    var meanX =
      xs.reduce(function (sum, value) {
        return sum + value;
      }, 0) / xs.length;
    var meanY =
      ys.reduce(function (sum, value) {
        return sum + value;
      }, 0) / ys.length;
    var numerator = 0;
    var denominator = 0;
    xs.forEach(function (x, index) {
      numerator += (x - meanX) * (ys[index] - meanY);
      denominator += (x - meanX) ** 2;
    });
    if (denominator > 0) slope = numerator / denominator;
  }
  return {
    logLogSlope: slope,
    firstMs: samples.length > 0 ? samples[0].time : null,
    lastMs: samples.length > 0 ? samples[samples.length - 1].time : null,
    growth:
      samples.length > 1 && samples[0].time > 0
        ? samples[samples.length - 1].time / samples[0].time
        : null,
  };
}

/**
 * Benchmark runtime growth along independent input dimensions.
 * @param {{
 *   backendIds?: string[],
 *   warmup?: number,
 *   samples?: number,
 *   onProgress?: (progress: *) => void
 * }} [options]
 * @return {Promise<*>}
 */
async function runPrettyScalingStudy(options) {
  var points = createPrettyScalingScenarios();
  var settings = Object.assign(
    { batchTargetMs: 20, maxBatchIterations: 512 },
    options || {},
    {
      scenarios: points,
      profile: false,
    },
  );
  var report = await runPrettyDifferentialCorpus(settings);
  report.kind = "scaling";
  report.schemaVersion = 2;
  report.timingPhases = [
    { id: "executeMs", label: "Execute" },
    { id: "marshalMs", label: "Marshal" },
    { id: "decodeMs", label: "Decode" },
    { id: "totalMs", label: "Total" },
  ];
  report.dimensions = [];
  /** @type {string[]} */
  var dimensionIds = [];
  points.forEach(function (point) {
    if (!dimensionIds.includes(point.dimension))
      dimensionIds.push(point.dimension);
  });
  dimensionIds.forEach(function (dimension) {
    /** @type {*[]} */
    var dimensionPoints = report.scenarios.filter(
      function (/** @type {*} */ scenario) {
        return scenario.dimension === dimension;
      },
    );
    /** @type {Record<string, Record<string, *>>} */
    var phaseTrends = {};
    report.timingPhases.forEach(function (/** @type {*} */ phase) {
      phaseTrends[phase.id] = {};
      report.backendIds.forEach(function (/** @type {string} */ id) {
        phaseTrends[phase.id][id] = summarizePrettyScalingTrend(
          dimensionPoints,
          id,
          phase.id,
        );
      });
    });
    report.dimensions.push({
      id: dimension,
      label:
        dimensionPoints.length > 0
          ? dimensionPoints[0].dimensionLabel || dimension
          : dimension,
      points: dimensionPoints,
      trends: phaseTrends.totalMs,
      phaseTrends: phaseTrends,
    });
  });
  return report;
}

/**
 * Measure one generated scaling point once per backend. Snapshotting each
 * backend separately attributes committed growth to the call that caused it.
 * @param {number} pointIndex
 * @param {{ backendIds?: string[] }} [options]
 * @return {Promise<*>}
 */
async function runPrettyMemoryScalingPoint(pointIndex, options) {
  var points = createPrettyScalingScenarios();
  if (
    !Number.isSafeInteger(pointIndex) ||
    pointIndex < 0 ||
    pointIndex >= points.length
  ) {
    throw new TypeError("invalid memory scaling point index");
  }
  var point = points[pointIndex];
  var requestedIds =
    options && Array.isArray(options.backendIds)
      ? options.backendIds
      : getPrettyBackends().map(function (backend) {
          return backend.id;
        });
  /** @type {Record<string, *>} */
  var backendResults = {};
  for (
    var backendIndex = 0;
    backendIndex < requestedIds.length;
    backendIndex++
  ) {
    var id = requestedIds[backendIndex];
    var before = collectPrettyMemorySnapshot([id]).backends[id];
    var sample = await runPrettyDifferentialCorpus({
      backendIds: [id],
      scenarios: [point],
      warmup: 0,
      samples: 1,
      batchTargetMs: 0,
      profile: false,
    });
    var after = collectPrettyMemorySnapshot([id]).backends[id];
    var scenario = sample.scenarios[0];
    var backendResult = scenario && scenario.backends[id];
    var rawMemory =
      backendResult && backendResult.memorySamples.length > 0
        ? backendResult.memorySamples[0]
        : null;
    var residentBefore = before.residentBytes;
    var residentAfter = after.residentBytes;
    if (rawMemory && typeof rawMemory.frontierBefore === "number") {
      residentBefore = rawMemory.frontierBefore;
    }
    if (rawMemory && typeof rawMemory.frontierAfterDecode === "number") {
      residentAfter = rawMemory.frontierAfterDecode;
    }
    backendResults[id] = {
      id: id,
      label: sample.summaries[id].label,
      status: sample.summaries[id].status,
      signature: backendResult ? backendResult.signature : null,
      output: backendResult ? backendResult.output : null,
      timing: backendResult ? backendResult.summary : null,
      committedBeforeBytes: before.committedBytes,
      committedAfterBytes: after.committedBytes,
      committedDeltaBytes:
        typeof before.committedBytes === "number" &&
        typeof after.committedBytes === "number"
          ? after.committedBytes - before.committedBytes
          : null,
      residentBeforeBytes: residentBefore,
      residentAfterBytes: residentAfter,
      residentDeltaBytes:
        typeof residentBefore === "number" && typeof residentAfter === "number"
          ? residentAfter - residentBefore
          : null,
      sharedMemoryGroup: after.sharedMemoryGroup,
      rawMemory: rawMemory,
      errors: backendResult ? backendResult.errors : [],
    };
  }
  var signatures = requestedIds
    .map(function (id) {
      return backendResults[id].signature;
    })
    .filter(function (signature) {
      return signature !== null;
    });
  return {
    pointIndex: pointIndex,
    caseId: point.case.id,
    label: point.case.label,
    dimension: point.dimension,
    dimensionLabel: point.dimensionLabel,
    size: point.size,
    sizeLabel: point.sizeLabel,
    width: point.width,
    input: point.input,
    output:
      requestedIds.length > 0 ? backendResults[requestedIds[0]].output : null,
    parity:
      signatures.length === requestedIds.length &&
      signatures.every(function (signature) {
        return signature === signatures[0];
      }),
    backends: backendResults,
  };
}

/**
 * Record per-call allocation and committed-memory growth while reusing the
 * current backend instances. This is deliberately separate from batched
 * runtime scaling so calibration repetitions cannot distort memory results.
 * @param {{ backendIds?: string[], pointIndexes?: number[], onProgress?: (progress: *) => void }} [options]
 * @return {Promise<*>}
 */
async function runPrettyMemoryScalingStudy(options) {
  var settings = options || {};
  var allPoints = createPrettyScalingScenarios();
  var pointIndexes = Array.isArray(settings.pointIndexes)
    ? settings.pointIndexes.map(Number)
    : allPoints.map(function (_point, index) {
        return index;
      });
  pointIndexes.forEach(function (index) {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= allPoints.length
    ) {
      throw new TypeError("invalid retained-memory point index");
    }
  });
  var backendIds = Array.isArray(settings.backendIds)
    ? settings.backendIds
    : getPrettyBackends().map(function (backend) {
        return backend.id;
      });
  var startedAt = new Date().toISOString();
  var started = performance.now();
  var initial = collectPrettyMemorySnapshot(backendIds);
  /** @type {*[]} */
  var points = [];
  for (var index = 0; index < pointIndexes.length; index++) {
    var point = await runPrettyMemoryScalingPoint(pointIndexes[index], {
      backendIds: backendIds,
    });
    backendIds.forEach(function (id) {
      var baseline = initial.backends[id];
      var result = point.backends[id];
      result.retainedCommittedGrowthBytes =
        baseline &&
        typeof baseline.committedBytes === "number" &&
        typeof result.committedAfterBytes === "number"
          ? result.committedAfterBytes - baseline.committedBytes
          : null;
      result.retainedResidentGrowthBytes =
        baseline &&
        typeof baseline.residentBytes === "number" &&
        typeof result.residentAfterBytes === "number"
          ? result.residentAfterBytes - baseline.residentBytes
          : null;
    });
    points.push(point);
    if (typeof settings.onProgress === "function") {
      settings.onProgress({
        completed: index + 1,
        total: pointIndexes.length,
        dimension: point.dimension,
        size: point.size,
      });
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }
  var final = collectPrettyMemorySnapshot(backendIds);
  /** @type {*[]} */
  var dimensions = [];
  points.forEach(function (point) {
    var dimension = dimensions.find(function (candidate) {
      return candidate.id === point.dimension;
    });
    if (!dimension) {
      dimension = {
        id: point.dimension,
        label: point.dimensionLabel,
        points: [],
      };
      dimensions.push(dimension);
    }
    dimension.points.push(point);
  });
  var mismatches = points.filter(function (point) {
    return !point.parity;
  });
  return {
    schemaVersion: 1,
    kind: "memory-retained",
    mode: "retained-instance",
    startedAt: startedAt,
    generatedAt: new Date().toISOString(),
    durationMs: performance.now() - started,
    backendIds: backendIds,
    pointCount: points.length,
    parityCount: points.length - mismatches.length,
    passed: mismatches.length === 0,
    mismatches: mismatches.map(function (point) {
      /** @type {Record<string, string[]>} */
      var backendErrors = {};
      backendIds.forEach(function (id) {
        if (point.backends[id].errors.length > 0) {
          backendErrors[id] = point.backends[id].errors;
        }
      });
      var mismatch = /** @type {*} */ ({
        caseId: point.caseId,
        label: point.label,
        width: point.width,
      });
      if (Object.keys(backendErrors).length > 0)
        mismatch.backendErrors = backendErrors;
      return mismatch;
    }),
    initialMemory: initial,
    finalMemory: final,
    dimensions: dimensions,
    points: points,
  };
}

/**
 * Benchmark two-dimensional input interactions with the same adaptive phase
 * batching used by the one-axis scaling study.
 * @param {{ backendIds?: string[], warmup?: number, samples?: number, batchTargetMs?: number, maxBatchIterations?: number, onProgress?: (progress: *) => void }} [options]
 * @return {Promise<*>}
 */
async function runPrettyInteractionStudy(options) {
  var scenarios = createPrettyInteractionScenarios();
  var settings = Object.assign(
    {
      warmup: 1,
      samples: 5,
      batchTargetMs: 20,
      maxBatchIterations: 512,
    },
    options || {},
    { scenarios: scenarios, profile: false },
  );
  var report = await runPrettyDifferentialCorpus(settings);
  report.kind = "interactions";
  report.schemaVersion = 1;
  report.timingPhases = [
    { id: "executeMs", label: "Execute" },
    { id: "marshalMs", label: "Marshal" },
    { id: "decodeMs", label: "Decode" },
    { id: "totalMs", label: "Total" },
  ];
  /** @type {*[]} */
  report.interactions = [];
  report.scenarios.forEach(function (/** @type {*} */ scenario) {
    var interaction = report.interactions.find(
      function (/** @type {*} */ candidate) {
        return candidate.id === scenario.interaction;
      },
    );
    if (!interaction) {
      interaction = {
        id: scenario.interaction,
        label: scenario.interactionLabel,
        xAxis: scenario.xAxis,
        yAxis: scenario.yAxis,
        xValues: [],
        yValues: [],
        points: [],
      };
      report.interactions.push(interaction);
    }
    if (
      !interaction.xValues.some(function (/** @type {*} */ value) {
        return value.value === scenario.x;
      })
    ) {
      interaction.xValues.push({ value: scenario.x, label: scenario.xLabel });
    }
    if (
      !interaction.yValues.some(function (/** @type {*} */ value) {
        return value.value === scenario.y;
      })
    ) {
      interaction.yValues.push({ value: scenario.y, label: scenario.yLabel });
    }
    interaction.points.push(scenario);
  });
  return report;
}

/**
 * Summarize an exact per-cycle memory series. Committed Wasm pages are a
 * high-water metric, so an unchanged tail is reported as an observed plateau,
 * not as proof that live memory is stable.
 * @param {*[]} points
 * @param {"committedBytes" | "residentBytes"} metric
 * @return {*}
 */
function summarizePrettyRepeatedMemory(points, metric) {
  var observed = points.filter(function (point) {
    return typeof point[metric] === "number" && Number.isFinite(point[metric]);
  });
  if (observed.length < 2) {
    return {
      metric: metric,
      samples: observed.length,
      initialBytes: observed.length === 1 ? observed[0][metric] : null,
      finalBytes: observed.length === 1 ? observed[0][metric] : null,
      growthBytes: null,
      growthEvents: 0,
      lastGrowthCycle: null,
      tailCycles: 0,
      tailGrowthBytes: null,
      plateau: null,
    };
  }
  var initial = observed[0];
  var final = observed[observed.length - 1];
  var growthEvents = 0;
  var lastGrowthCycle = null;
  for (var index = 1; index < observed.length; index++) {
    if (observed[index][metric] > observed[index - 1][metric]) {
      growthEvents += 1;
      lastGrowthCycle = observed[index].cycle;
    }
  }
  var completedCycles = Math.max(1, final.cycle - initial.cycle);
  var tailCycles = Math.min(8, Math.max(1, Math.floor(completedCycles / 4)));
  var tailStartCycle = final.cycle - tailCycles;
  var tailStart = observed[0];
  observed.forEach(function (point) {
    if (point.cycle <= tailStartCycle) tailStart = point;
  });
  var tailGrowth = final[metric] - tailStart[metric];
  return {
    metric: metric,
    samples: observed.length,
    initialBytes: initial[metric],
    finalBytes: final[metric],
    growthBytes: final[metric] - initial[metric],
    growthEvents: growthEvents,
    lastGrowthCycle: lastGrowthCycle,
    tailCycles: final.cycle - tailStart.cycle,
    tailGrowthBytes: tailGrowth,
    plateau: tailGrowth === 0,
  };
}

/**
 * Deduplicate shared memories (the two VIR entry points use one runtime) and
 * convert raw snapshots into graph-ready cycle series.
 * @param {*[]} samples
 * @param {string[]} backendIds
 * @param {number} callsPerCycle
 * @return {*}
 */
function buildPrettyRepeatedMemoryTrace(samples, backendIds, callsPerCycle) {
  /** @type {Map<string, { id: string, label: string, backendIds: string[] }>} */
  var groups = new Map();
  samples.forEach(function (sample) {
    backendIds.forEach(function (id) {
      var memory = sample.memory.backends[id];
      if (!memory) return;
      var groupId = memory.sharedMemoryGroup || id;
      var group = groups.get(groupId);
      if (!group) {
        group = {
          id: groupId,
          label:
            groupId === "vir-runtime"
              ? "VIR shared runtime"
              : memory.label || id,
          backendIds: [],
        };
        groups.set(groupId, group);
      }
      if (!group.backendIds.includes(id)) group.backendIds.push(id);
    });
  });
  var series = Array.from(groups.values()).map(function (group) {
    var points = samples.map(function (sample) {
      var memory = null;
      for (var index = 0; index < group.backendIds.length; index++) {
        var candidate = sample.memory.backends[group.backendIds[index]];
        if (candidate) {
          memory = candidate;
          break;
        }
      }
      var calls = group.backendIds.reduce(function (sum, id) {
        return sum + Number(sample.callsByBackend[id] || 0);
      }, 0);
      return {
        cycle: sample.cycle,
        calls: calls,
        committedBytes: memory ? memory.committedBytes : null,
        residentBytes: memory ? memory.residentBytes : null,
      };
    });
    return {
      id: group.id,
      label: group.label,
      backendIds: group.backendIds,
      points: points,
      committed: summarizePrettyRepeatedMemory(points, "committedBytes"),
      resident: summarizePrettyRepeatedMemory(points, "residentBytes"),
    };
  });
  return {
    schemaVersion: 1,
    sampleUnit: "cycle",
    callsPerBackendPerCycle: callsPerCycle,
    samples: samples,
    series: series,
  };
}

/**
 * Repeatedly alternate structurally distinct inputs in one backend instance.
 * This catches state leakage that same-input timing samples can miss and records
 * committed-memory growth over the retained-instance workload.
 * @param {{ backendIds?: string[], cycles?: number, onProgress?: (progress: *) => void }} [options]
 * @return {Promise<*>}
 */
async function runPrettyRepeatedCallStudy(options) {
  var settings = options || {};
  var cycles = settings.cycles === undefined ? 32 : Number(settings.cycles);
  if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 1000) {
    throw new TypeError("invalid repeated-call cycle count");
  }
  var scaling = createPrettyScalingScenarios();

  /** @param {string} dimension @param {(point: *) => boolean} predicate */
  function scalingPoint(dimension, predicate) {
    var point = scaling.find(function (candidate) {
      return candidate.dimension === dimension && predicate(candidate);
    });
    if (!point) throw new Error("missing repeated-call workload " + dimension);
    return point;
  }

  var sourcePoints = [
    scalingPoint("text", function (point) {
      return point.size === 8;
    }),
    scalingPoint("breaks", function (point) {
      return point.size === 64;
    }),
    scalingPoint("tags", function (point) {
      return point.size === 64;
    }),
    scalingPoint("text", function (point) {
      return point.size === 2048;
    }),
    scalingPoint("nodes", function (point) {
      return point.size >= 500;
    }),
  ];
  var workloads = sourcePoints.map(function (point, index) {
    return {
      case: {
        id: "repeat-" + point.dimension + "-" + point.size,
        label: point.case.label,
        format: point.case.format,
        origin: "repeated",
      },
      width: point.width,
      input: point.input,
      workloadIndex: index,
    };
  });
  /** @type {*[]} */
  var scenarios = [];
  for (var cycle = 0; cycle < cycles; cycle++) {
    for (var position = 0; position < workloads.length; position++) {
      var workload = workloads[(position + cycle) % workloads.length];
      scenarios.push({
        case: workload.case,
        width: workload.width,
        input: workload.input,
        repeatRound: cycle + 1,
        sequenceIndex: scenarios.length,
      });
    }
  }
  /** @type {*[]} */
  var memoryTraceSamples = [];
  /** @type {string[]} */
  var tracedBackendIds = [];
  var report = await runPrettyDifferentialCorpus({
    backendIds: settings.backendIds,
    scenarios: scenarios,
    warmup: 0,
    samples: 1,
    batchTargetMs: 0,
    profile: true,
    onBenchmarkStart: function (state) {
      tracedBackendIds = state.backendIds;
      /** @type {Record<string, number>} */
      var callsByBackend = {};
      tracedBackendIds.forEach(function (id) {
        callsByBackend[id] = 0;
      });
      memoryTraceSamples.push({
        cycle: 0,
        callsByBackend: callsByBackend,
        memory: state.memory,
      });
    },
    onScenario: function (scenario) {
      if ((scenario.sequenceIndex + 1) % workloads.length !== 0) return;
      /** @type {Record<string, number>} */
      var callsByBackend = {};
      tracedBackendIds.forEach(function (id) {
        callsByBackend[id] = scenario.repeatRound * workloads.length;
      });
      memoryTraceSamples.push({
        cycle: scenario.repeatRound,
        callsByBackend: callsByBackend,
        memory: collectPrettyMemorySnapshot(tracedBackendIds),
      });
    },
    onProgress: settings.onProgress,
  });
  report.kind = "repeated";
  report.schemaVersion = 2;
  report.cycles = cycles;
  report.workloadCount = workloads.length;
  report.callsPerBackend = scenarios.length;
  report.totalBackendCalls =
    scenarios.length * (report.backendIds.length - report.unavailable.length);
  /** @type {*[]} */
  var stabilityMismatches = [];
  report.workloads = workloads.map(function (workload) {
    var observations = report.scenarios.filter(
      function (/** @type {*} */ scenario) {
        return scenario.caseId === workload.case.id;
      },
    );
    /** @type {Record<string, boolean>} */
    var stableByBackend = {};
    report.backendIds.forEach(function (/** @type {string} */ id) {
      var signatures = new Set(
        observations.map(function (/** @type {*} */ scenario) {
          return scenario.backends[id] ? scenario.backends[id].signature : null;
        }),
      );
      stableByBackend[id] = signatures.size === 1 && !signatures.has(null);
      if (!stableByBackend[id]) {
        stabilityMismatches.push({ caseId: workload.case.id, backendId: id });
      }
    });
    return {
      id: workload.case.id,
      label: workload.case.label,
      width: workload.width,
      input: workload.input,
      output: observations.length > 0 ? observations[0].output : null,
      callsPerBackend: observations.length,
      parity: observations.every(function (/** @type {*} */ scenario) {
        return scenario.parity;
      }),
      stableByBackend: stableByBackend,
    };
  });
  report.stabilityMismatches = stabilityMismatches;
  report.passed = report.passed && stabilityMismatches.length === 0;
  report.memoryTrace = buildPrettyRepeatedMemoryTrace(
    memoryTraceSamples,
    report.backendIds,
    workloads.length,
  );
  /** @type {Record<string, *>} */
  report.memoryGrowth = {};
  report.backendIds.forEach(function (/** @type {string} */ id) {
    var before =
      report.runtimeProfileBefore && report.runtimeProfileBefore.backends[id];
    var after = report.runtimeProfile && report.runtimeProfile.backends[id];
    var beforeBytes = before ? before.memoryBytes : null;
    var afterBytes = after ? after.memoryBytes : null;
    report.memoryGrowth[id] = {
      beforeBytes: beforeBytes,
      afterBytes: afterBytes,
      deltaBytes:
        typeof beforeBytes === "number" && typeof afterBytes === "number"
          ? afterBytes - beforeBytes
          : null,
    };
  });
  return report;
}
