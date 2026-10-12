# JSON-safe value codec prototype

This is a local implementation checkpoint for the selected JSON-safe codec
direction. It is not a public call/factory option or a published wire format.
The standard manifest-12 native/value contract and default call behavior remain
the basis of conversion. The compiler supplies all constructor, field, storage
and recursive-owner facts.

The internal optional object binder accepts:

```js
runtime.nativeValueCodec(admittedPair, { representation: "json-safe-v1" });
```

The selected plan has the existing `lower`/`lift` operations. Lowering uses a
`ConstructorScratch` for one operation; binding does not own values or replace
the call's transfer/disposal rules. Normal and JSON-safe plans are cached
separately by pair identity within each runtime. This is a prototype selection
seam, not a supported standalone pointer API for applications.

Records, constructor variants, tagged Options, enums, booleans and sequences
use the same shape and structural construction plans. Changes are at leaves:

| Value | JSON-safe representation |
| --- | --- |
| Nat, Int, UInt64 | Canonical decimal string |
| UInt8/16/32, wasm32 USize | Integer Number in the native range |
| Unit | Exactly `null` |
| ByteArray | Array of integer Numbers from 0 through 255 |
| String | String |

Canonical decimals have no whitespace, plus sign, exponent, leading zeros or
negative zero. Only Int accepts a negative sign. Large integers are never routed
through Number. Packed UInt64/Unit/USize fields use the same selected operations
as boxed fields. Byte adaptation is local to the byte leaf's native input buffer.
No complete intermediate BigInt/undefined/Uint8Array value graph is constructed.

For example, `none`, `some none`, and `some ()` retain these distinct values:

```js
{ kind: "none" }
{ kind: "some", value: { kind: "none" } }
{ kind: "some", value: null }
```

Float, resource, opaque-reference, callback and specialized Expr views are
excluded from this prototype. Profile eligibility is checked over the complete
admitted type before binding, even for an empty collection. The error identifies
the excluded domain's path. Existing unsupported packed conversions are also
rejected. There is no ToJson fallback or inference from the actual value.

## Qualification and limits

Focused unit tests exercise the production binder, scratch and primitive code
against modeled native allocation/reference counting. The smoke fixture uses
generated descriptors and actual Lean functions to observe Option constructors,
payload amounts, packed fields and recursive structures independently of lifting.
It passes both Wasm profiles with ordinary JSON serialization/parsing in the test.
Failure/recovery cases accompany the successful calls.

Structure field types now come from the instantiated constructor, shared with
inductive classification. An importing module need not contain private projection
declarations. The imported-private-field fixture qualifies generated conversion
and independent Lean observations on both Wasm profiles. Source field names and
compiler storage layouts still determine the same record mappings.

Erased proof fields remain a generation error. Dropping `Char.valid` or a
`Fin` bound proof would remove the evidence for an invariant without supplying a
boundary check. Supporting such types needs an explicit, reusable rule that
validates their runtime values; constructor storage alone does not supply it.

The smoke test temporarily selects the prototype plans inside its own runtime's
internal lowering/lifting methods. No public call configuration or independent
consumer-expectation format is introduced. A future public selection must agree
at both endpoints and participate in the relevant contract checks.

Matching native-server encoding is not implemented. Full Part Manual now passes
the private InternalId field and stops at metadata.assignedNumber -> Numbering.letter
-> Char.valid, whose proof has erased runtime layout. Other independently observed
NameMap/Fin limits remain; no complete Part descriptor is emitted.
Neither full-document browser acceptance nor performance has been qualified.
Infoview JSON-RPC, consumer rendering/retention, pins and publication are unchanged.
