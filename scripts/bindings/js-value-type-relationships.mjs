/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Deliberately bounded: Array relationships, native pair projections, dynamic
// object results and closed String narrowing, not arbitrary TS generic subtyping.
// Check the upstream binder and its occurrences before checking the configured
// Lean types. A reviewed "preserving" label is not evidence of this relationship.
export function validateJsValueTypeRelationships(protocol, symbols) {
  const arrayOperation = new Map([
    ["js.array.empty", "Array"],
    ["js.array.push", "Array.push"],
    ["js.array.length", "Array.length"],
    ["js.array.item", "Array"],
  ]).get(protocol.target);
  const tuplePosition = { "js.tuple2.first": 0, "js.tuple2.second": 1 }[protocol.target];
  const dynamicContract = {
    "js.object.get": "dynamic property result",
    "js.string.fromAny": "closed String narrowing",
  }[protocol.target];
  if (arrayOperation === undefined && tuplePosition === undefined && dynamicContract === undefined) return;

  const label = dynamicContract ?? (arrayOperation === undefined ? "tuple [A, B] position" : "TypeScript Array<T> element");
  const require = (condition, detail) => {
    if (!condition) throw new Error(`${protocol.id}: ${label} relationship violated: ${detail}`);
  };
  const parameters = protocol.typeParameters ?? [];
  const jsType = (inner) => ({
    lean: `Lean.Vir.Js ${inner}`, representation: "js-resource", resourceInner: inner,
  });
  const arrayType = (element) => ({
    lean: `Lean.Vir.Js.Array ${element}`,
    representation: "js-resource", resourceInner: `Lean.Vir.Js.Array.Value ${element}`,
  });
  const checkType = (actual, expected, position) => {
    for (const [key, value] of Object.entries(expected)) {
      require(actual?.[key] === value, `${position} ${key} must be ${value}, got ${actual?.[key]}`);
    }
  };
  const checkSignature = (args, result, receiver = true) => {
    require(protocol.arguments.length === args.length, `expected ${args.length} runtime arguments`);
    args.forEach((type, index) => checkType(protocol.arguments[index].type, type, `argument ${index}`));
    if (receiver && args.length > 0) require(protocol.arguments[0].role === "receiver", "argument 0 must be the receiver");
    checkType(protocol.result.type, result, "result");
  };

  if (dynamicContract !== undefined) {
    require(protocol.upstreamRelation.kind === "vir-owned", "must remain a VIR-owned dynamic operation");
    const any = {
      lean: "Lean.Vir.Js.Any", representation: "js-resource", resourceInner: "Lean.Vir.Js.Any.Value",
    };
    if (protocol.target === "js.object.get") {
      require(parameters.length === 1, "only the receiver may be polymorphic; a dynamic key cannot determine a result parameter");
      checkSignature([jsType(parameters[0]), jsType("String")], any);
    } else {
      require(parameters.length === 0, "the predicate checks String only, never an arbitrary phantom");
      checkSignature([any], jsType("String"), false);
    }
    return;
  }

  if (tuplePosition !== undefined) {
    require(parameters.length === 2, "each tuple position needs its own parameter");
    const [first, second] = parameters;
    checkSignature([{
      lean: `Lean.Vir.Js.Tuple2 (Lean.Vir.Js ${first}) (Lean.Vir.Js ${second})`,
      representation: "js-resource",
      resourceInner: `Lean.Vir.Js.Tuple2.Value (Lean.Vir.Js ${first}) (Lean.Vir.Js ${second})`,
    }], jsType(parameters[tuplePosition]));
    return;
  }

  require(protocol.upstreamRelation.kind === "upstream-adapter" &&
    protocol.upstreamRelation.member === arrayOperation, `must reference ${arrayOperation}`);
  const array = symbols?.get("Array");
  require(array?.kind === "interface" && array.typeParameters?.length === 1,
    "upstream must declare exactly one Array type parameter");
  const parameter = array.typeParameters[0];
  require(parameter.constraint === undefined && parameter.default === undefined,
    "constrained/defaulted upstream parameters are not supported by this lane");
  const element = (shape) => shape?.kind === "ref" && shape.id === parameter.name &&
    (shape.args ?? []).length === 0;
  const number = (shape) => shape?.kind === "primitive" && shape.name === "number";
  require(array.indexSignatures?.length === 1, "upstream must have one numeric index signature");
  const indexer = array.indexSignatures[0];
  require(indexer.kind === "function" && indexer.effect === "pure" &&
    indexer.args.length === 1 && number(indexer.args[0].type) &&
    !indexer.args[0].optional && !indexer.args[0].rest && element(indexer.result),
  "upstream [n: number]: T must return the receiver's T (unchecked-index lane)");
  require(parameters.length === 1, "receiver/item/result must share one parameter, never independent parameters");
  const [leanElement] = parameters;
  const receiver = arrayType(leanElement);
  const value = jsType(leanElement);
  const jsNumber = jsType("Float");

  switch (protocol.target) {
    case "js.array.empty":
      checkSignature([], receiver);
      break;
    case "js.array.push": {
      const push = symbols.get("Array.push");
      const shape = push?.shape;
      require(push?.typeParameters?.length === 0 && shape?.kind === "function" && shape.effect === "pure" &&
        shape.args.length === 1 && shape.args[0].rest && !shape.args[0].optional &&
        shape.args[0].type.kind === "array" && element(shape.args[0].type.element) && number(shape.result),
      "upstream push(...items: T[]): number must use the receiver's T; only one-item arity is supported");
      checkSignature([receiver, value], jsNumber);
      break;
    }
    case "js.array.item":
      checkSignature([receiver, jsNumber], value);
      break;
    case "js.array.length":
      require(number(symbols.get("Array.length")?.accessors?.get), "upstream length getter must return number");
      checkSignature([receiver], jsNumber);
      break;
  }
}
