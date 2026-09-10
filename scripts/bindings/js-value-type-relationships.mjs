/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Deliberately bounded: Array relationships, native pair projections, NodeList
// array conversion, dynamic object results, closed String narrowing and selected
// Promise signatures,
// not arbitrary TS generic subtyping or runtime payload validation.
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
  const promiseOperation = {
    "js.promise.thenValue": "value",
    "js.promise.thenPromise": "promise",
    "js.promise.thenVoid": "void",
    "js.promise.thenValueWithRejection": "both-value",
    "js.promise.thenVoidWithRejection": "both-void",
    "js.promise.catchValue": "catch",
  }[protocol.target];
  const dynamicContract = {
    "js.object.get": "dynamic property result",
    "js.string.fromAny": "closed String narrowing",
  }[protocol.target];
  const nodeListConversion = protocol.target === "js.nodeList.toArray";
  if (arrayOperation === undefined && tuplePosition === undefined && dynamicContract === undefined &&
      promiseOperation === undefined && !nodeListConversion) return;

  const label = dynamicContract ?? (nodeListConversion ? "VIR NodeList-to-Array element" :
    promiseOperation !== undefined ? "TypeScript Promise<T> selected subset" :
    arrayOperation === undefined ? "tuple [A, B] position" : "TypeScript Array<T> element");
  const require = (condition, detail) => {
    if (!condition) throw new Error(`${protocol.id}: ${label} relationship violated: ${detail}`);
  };
  const parameters = protocol.typeParameters ?? [];
  // These bounded contracts spell primitive constants without qualification.
  // Reject capture before textual comparison; renaming a binder to Float must
  // not turn Array.push's numeric result into its caller-selected element type.
  for (const parameter of parameters) {
    require(!["Float", "String", "Unit"].includes(parameter),
      `type parameter ${parameter} shadows a fixed Lean type; choose a distinct name`);
  }
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

  if (nodeListConversion) {
    require(protocol.upstreamRelation.kind === "vir-owned", "must remain a VIR-owned conversion");
    require(parameters.length === 1, "input and output must share one element parameter");
    const [element] = parameters;
    // NodeList retains its full Lean-view parameter; Array uses a JS shape.
    // This checks VIR's representation contract, not upstream NodeList<T> derivation.
    checkSignature([{
      lean: `Lean.Vir.Js.NodeList (Lean.Vir.Js ${element})`, representation: "js-resource",
      resourceInner: `Lean.Vir.Js.NodeList.Value (Lean.Vir.Js ${element})`,
    }], arrayType(element));
    return;
  }

  if (promiseOperation !== undefined) {
    const catching = promiseOperation === "catch";
    const voidResult = promiseOperation.endsWith("void");
    const both = promiseOperation.startsWith("both-");
    const member = catching ? "Promise.catch" : "Promise.then";
    require(protocol.upstreamRelation.kind === "upstream-adapter" &&
      protocol.upstreamRelation.member === member, `must reference ${member}`);
    checkPromiseDeclaration(symbols, member, require);
    require(parameters.length === (catching || voidResult ? 1 : 2),
      "receiver and selected result need correlated parameters; rejection input is always Any");
    const [input, output] = parameters;
    const promise = (inner) => ({
      lean: `Lean.Vir.Js.Promise ${inner}`, representation: "js-resource",
      resourceInner: `Lean.Vir.Js.Promise.Value ${inner}`,
    });
    const result = promise(voidResult ? "Lean.Vir.Js.Undefined.Value" : catching ? input : output);
    const callbackResult = voidResult ? "Unit" : promiseOperation === "promise" ?
      promise(output).lean : jsType(catching ? input : output).lean;
    const callback = (argument) => {
      const group = (type) => type.includes(" ") ? `(${type})` : type;
      const args = `${group(argument)} ${group(callbackResult)}`;
      return { lean: `Lean.Vir.Js.Function1 ${args}`, representation: "js-resource",
        resourceInner: `Lean.Vir.Js.Function.Unary ${args}` };
    };
    const args = [promise(input), callback(catching ? "Lean.Vir.Js.Any" : jsType(input).lean)];
    if (both) args.push(callback("Lean.Vir.Js.Any"));
    checkSignature(args, result);
    return;
  }

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
      require(push?.optional !== true, "upstream Array.push must not be optional");
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
      require(symbols.get("Array.length")?.optional !== true, "upstream Array.length must not be optional");
      require(number(symbols.get("Array.length")?.accessors?.get), "upstream length getter must return number");
      checkSignature([receiver], jsNumber);
      break;
  }
}

// Recognize the pinned declaration's relationships before checking Lean policy.
// Binder/argument spelling is irrelevant; unsupported overloads, defaults and
// constraints fail closed. This is not a general TS assignability algorithm.
function checkPromiseDeclaration(symbols, member, require) {
  const isRef = (shape, name) => shape?.kind === "ref" && shape.id === name &&
    (shape.args ?? []).length === 0;
  const opaque = (shape, name) => shape?.kind === "opaque" && shape.name === name;
  const applied = (shape, name, element) => shape?.kind === "ref" && shape.id === name &&
    shape.args?.length === 1 && element(shape.args[0]);
  const union = (shape, left, right) => shape?.kind === "union" && shape.options.length === 2 &&
    ((left(shape.options[0]) && right(shape.options[1])) ||
     (right(shape.options[0]) && left(shape.options[1])));
  const promise = symbols?.get("Promise");
  require(promise?.kind === "interface" && promise.typeParameters?.length === 1,
    "upstream Promise must have one type parameter");
  const parameter = promise.typeParameters[0];
  require(parameter.constraint === undefined && parameter.default === undefined,
    "upstream Promise parameter must be unconstrained and have no default");
  const method = symbols.get(member);
  require(method?.optional !== true, `upstream ${member} must not be optional`);
  const catching = member === "Promise.catch";
  const parameters = method?.typeParameters;
  require(method?.kind === "method" && parameters?.length === (catching ? 1 : 2),
    "unexpected upstream method type parameters");
  require(parameters.every((p) => p.constraint === undefined) &&
    new Set([parameter.name, ...parameters.map((p) => p.name)]).size === parameters.length + 1,
  "upstream method parameters must be unconstrained and must not shadow the receiver");
  require(catching ? opaque(parameters[0].default, "never") :
    isRef(parameters[0].default, parameter.name) && opaque(parameters[1].default, "never"),
  "unsupported upstream method defaults");
  const shape = method.shape;
  require(shape?.kind === "function" && shape.effect === "pure" &&
    shape.args.length === (catching ? 1 : 2), "unexpected upstream method arity or overloads");
  const handler = (argument, input, output) => {
    const fn = argument?.type?.element;
    // TypeScript's explicit this describes the receiver, not a runtime argument.
    require(!fn?.args?.some((arg) => arg.name === "this"),
      "upstream callback this parameters are not supported");
    return argument?.optional && !argument.rest && argument.type.kind === "option" &&
      argument.type.absence === "nullish" && fn?.kind === "function" && fn.effect === "pure" &&
      fn.args.length === 1 && !fn.args[0].optional && !fn.args[0].rest && input(fn.args[0].type) &&
      union(fn.result, (s) => isRef(s, output),
        (s) => applied(s, "PromiseLike", (t) => isRef(t, output)));
  };
  const output = parameters[0].name;
  require(handler(shape.args[0], (s) => catching ? opaque(s, "any") : isRef(s, parameter.name), output),
    "upstream handler must preserve its input and R | PromiseLike<R> result");
  if (!catching) require(handler(shape.args[1], (s) => opaque(s, "any"), parameters[1].name),
    "upstream rejection handler must accept any and preserve its own result parameter");
  require(applied(shape.result, "Promise", (s) => union(s,
    (t) => isRef(t, catching ? parameter.name : output),
    (t) => isRef(t, catching ? output : parameters[1].name))),
  "upstream result must be Promise<T | R> for catch or Promise<R1 | R2> for then");
}
