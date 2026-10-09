# Native Option values

`Option α` uses `{ kind: "none" }` or `{ kind: "some", value }` for every `α`.
This is a JavaScript value contract for the optional structural converter, not
JSON transport. Ordinary calls, callback arguments/results and nested object
fields use the same representation.

## Preserve the constructor

The retired nullable/bare-payload mapping discarded information:

| Lean value | Retired JS value | After lowering again |
| --- | --- | --- |
| `none : Option (Option Nat)` | `null` | `none` |
| `some none : Option (Option Nat)` | `null` | `none` |
| `some () : Option Unit` | `undefined` | `none` |
| `some null : Option Js.Any` | `null` | `none` |
| `some undefined : Option Js.Any` | `undefined` | `none` |

The wrapper preserves the outer constructor independently of the payload.
`some` requires an own `value` property. Unit still lifts to undefined; resources
still preserve their exact JS values or opaque Lean reference ownership. An
object whose payload happens to contain `kind: "none"` is ordinary payload data
inside the outer `some` object. Payload validation follows the element type.

## One representation

| Candidate | Assessment |
| --- | --- |
| Nullable/bare values | Convenient for some scalar types, but loses constructors for supported element types. |
| Nullable scalars, tagged nested/nullable payloads | Can preserve distinctions with additional type rules; creates multiple Option representations and repeats those rules in conversion, templates and callers. |
| Zero/one-element arrays | Lossless with uniform wrapping, but introduces a separate constructor convention. |
| Uniform constructor objects | Lossless presence, the same zero/one-field spelling as custom inductives, and one normalization rule. Selected. |

The converter does not infer when a nullable encoding happens to be safe. It
does not add a mode, adapter, sentinel, constructor registry or public helper.
The old Option forms are rejected under the [API change policy](../../CONTRIBUTING.md#api-changes).
Applications needing a JavaScript nullable or optional value can use the existing
exact `Js.Nullable` and `Js.UndefinedOr` boundaries; those types are unchanged.

All structure fields are required. To select an absent Option field, supply
`{ kind: "none" }` explicitly; the converter does not synthesize missing fields.

Option and Prod now use compiler-owned generic constructor/record metadata and
cached JS codecs. Dedicated OPTION/PROD/LIST descriptor tags are retired; the
iterative List adapter stays in the optional codec composition. Lexical recursive
references preserve ownership through these complete container descriptors.

## Implementation and limits

Lean's compiled Option layout, constructor ordinals and ownership stay the
same. The manifest now describes Option as an ordinary custom inductive and
Prod as a structure. None uses its scalar tag; some owns one lowered field.
Lexical references carry their enclosing type across complete container scopes;
Array and Sum/Except retain the current scope. No synthetic constructor
descriptor or metadata validation layer is needed.

Lifting allocates a JS wrapper object for each Option. It adds no Lean constructor
allocation or bridge call compared with the previous conversion. There is no
serialization or public codec framework. The managed
core and opaque JSL path still do not require structural materialization.

The [real producer fixture](../../fixtures/runtime/OptionValues.lean) and
[public runtime test](../../tests/runtime/option-values-smoke.mjs) cover independent
Lean constructor observations, direct Lean results, nested options/Unit, large
Nat, arrays/products/records, recursion through Option/Sum, callbacks, exact JS
payloads, opaque references, partial-allocation cleanup and failure followed by
reuse. They also pin unchanged nullable/optional JS boundaries. These cases
establish the tested behavior; they do not claim a general proof or support for
cycles, unsupported descriptors or arbitrary structural reference identity.

Plain JSON.stringify still rejects bigint and drops undefined object fields.
The runner's JSON text is an editing convenience; Unit inputs can use an explicit
null payload, which normal Unit conversion accepts, while lifted Unit remains
undefined. Persisted formats need an [explicit JSON codec](EXPLICIT_CODECS.md).

This decision follows the PR221 review's compositionality finding, PR224's
recursive-context repair, and PR227's separate application-owned JSON regressions.
It fixes native Option presence without introducing a JSON converter API.
