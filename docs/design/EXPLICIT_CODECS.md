# Explicit codec rationale and provenance

The implemented experimental API and its supported domains are defined by the
[JSON-safe value codec contract](JSON_SAFE_VALUE_CODEC.md). That document owns
the current encodings, generated Lean writer, `callWith` representation selection,
adapter rules and qualification requirements.

## Why explicit encoding matters

Native JavaScript values can include bigint, undefined and owned references.
Plain JSON serialization cannot preserve all of them. In particular, nullable
Option encoding loses the distinction between `none` and `some none`; uniform
constructor tags preserve presence independently of the payload. See the
[native Option decision](OPTION_VALUES.md).

An explicit encoding must preserve the constructor and field distinctions within
its supported domain, including integer precision. It is separate from reference
identity and from the decision to materialize Lean state as a JavaScript graph.
Ordinary calls, exact `Js` values and opaque `JSL` values remain independently
usable. Applications should select JSON encoding when their transport or
persisted format requires it.

## Origins and application regressions

This direction grew from the constructor review in
[PR221](https://github.com/ejgallego/lean-vir/pull/221) and the recursive-context
repair in [PR224](https://github.com/ejgallego/lean-vir/pull/224). The subsequent
implementation reuses compiler-generated descriptors and construction plans;
it does not require a separate handwritten decoder for each application type.

The earlier [custom-codec regression](../../fixtures/runtime/JsonCodecs.lean)
checks tagged options, unit presence and exact integers through ordinary calls
and opaque references. The [Tamagotchi regression](../../fixtures/runtime/TamagotchiCodecs.lean)
saves and restores application state across runtime disposal, then continues its
normal transitions. These fixture-local converters document application behavior;
they do not define the generated codec API or qualify arbitrary adapter inverses.
