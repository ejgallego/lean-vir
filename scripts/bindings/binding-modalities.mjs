/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  leanBinderIdentifier,
  validateLeanIdentifier,
} from "./lean-syntax.mjs";

const derivedPortIntentFields = [
  "effect",
  "receiver",
  "resourceArguments",
  "resultRepresentation",
];

function nonemptyString(value) {
  return typeof value === "string" && value.length !== 0;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validatePassing(value, context) {
  if (!["borrowed", "owned", "consumed"].includes(value)) {
    throw new Error(`${context} passing must be borrowed, owned, or consumed`);
  }
}

function validateRetention(value, context) {
  if (!["call", "until-release", "runtime"].includes(value)) {
    throw new Error(`${context} retention must be call, until-release, or runtime`);
  }
}

function validateKeys(value, allowed, context) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${context} has unsupported field ${key}`);
  }
}

function validateModalityOverride(value, context, { receiver = false } = {}) {
  if (!object(value)) throw new Error(`${context} must be an object`);
  if (Object.keys(value).length === 0) throw new Error(`${context} must select a modality`);
  validateKeys(value, receiver ? ["kind", "passing", "retention"] : ["passing", "retention"], context);
  if (value.passing !== undefined) validatePassing(value.passing, context);
  if (value.retention !== undefined) validateRetention(value.retention, context);
  if (receiver && value.kind !== undefined && !["global", "argument"].includes(value.kind)) {
    throw new Error(`${context} kind must be global or argument`);
  }
}

function validateException(exception, context) {
  if (!object(exception) || !nonemptyString(exception.reason)) {
    throw new Error(`${context} requires a reason`);
  }
  validateKeys(exception, ["reason", "receiver", "arguments", "result", "effect"], context);
  if (!["receiver", "arguments", "result", "effect"].some((key) => exception[key] !== undefined)) {
    throw new Error(`${context} must define an override`);
  }
  if (exception.receiver !== undefined) {
    validateModalityOverride(exception.receiver, `${context} receiver`, { receiver: true });
  }
  if (exception.arguments !== undefined) {
    if (!object(exception.arguments)) throw new Error(`${context} arguments must be an object`);
    if (Object.keys(exception.arguments).length === 0) {
      throw new Error(`${context} arguments must name an override`);
    }
    for (const [name, override] of Object.entries(exception.arguments)) {
      if (!nonemptyString(name)) throw new Error(`${context} argument name must be non-empty`);
      validateModalityOverride(override, `${context} argument ${name}`);
    }
  }
  if (exception.result !== undefined) {
    if (!object(exception.result)) throw new Error(`${context} result must be an object`);
    validateKeys(exception.result, ["ownership"], `${context} result`);
    if (!["owned", "borrowed"].includes(exception.result.ownership)) {
      throw new Error(`${context} result ownership must be owned or borrowed`);
    }
  }
  if (exception.effect !== undefined) {
    if (!object(exception.effect) || !nonemptyString(exception.effect.id) ||
        !nonemptyString(exception.effect.lean)) {
      throw new Error(`${context} effect must provide id and Lean name`);
    }
    validateKeys(exception.effect, ["id", "lean"], `${context} effect`);
  }
}

export function validateGenerationProfile(generation, context = "generation") {
  const profile = generation?.abiProfile;
  if (!object(profile) || !nonemptyString(profile.id) || !object(profile.effect) ||
      !nonemptyString(profile.effect.id) || !nonemptyString(profile.effect.lean) ||
      !object(profile.types) || !object(profile.resource) ||
      !nonemptyString(profile.resource.constructor) ||
      !nonemptyString(profile.resource.nullableConstructor) ||
      !object(profile.resource.argument) || !object(profile.resource.result) ||
      !object(profile.receiver) || !object(profile.receiver.default) ||
      !Array.isArray(profile.receiver.globalTypes) ||
      !profile.receiver.globalTypes.every(nonemptyString)) {
    throw new Error(`${context} does not define a valid ABI profile`);
  }
  if (new Set(profile.receiver.globalTypes).size !== profile.receiver.globalTypes.length) {
    throw new Error(`${context} ABI profile repeats a global receiver type`);
  }
  for (const [name, type] of Object.entries(profile.types)) {
    if (!object(type) || !nonemptyString(type.lean) ||
        !["immediate", "js-resource"].includes(type.representation)) {
      throw new Error(`${context} ABI profile type ${name} is invalid`);
    }
  }
  validatePassing(profile.resource.argument.passing, `${context} resource argument`);
  validateRetention(profile.resource.argument.retention, `${context} resource argument`);
  if (!["owned", "borrowed"].includes(profile.resource.result.ownership)) {
    throw new Error(`${context} resource result ownership must be owned or borrowed`);
  }
  validatePassing(profile.receiver.default.passing, `${context} receiver`);
  validateRetention(profile.receiver.default.retention, `${context} receiver`);
  if (generation.exceptions !== undefined && !object(generation.exceptions)) {
    throw new Error(`${context} exceptions must be an object`);
  }
  if (generation.methodPolicies !== undefined && !object(generation.methodPolicies)) {
    throw new Error(`${context} methodPolicies must be an object`);
  }
  for (const [member, policy] of Object.entries(generation.methodPolicies ?? {})) {
    if (!object(policy)) throw new Error(`${context} method policy ${member} must be an object`);
    validateKeys(policy, ["signature", "omittedOptionalParameters"], `${context} method policy ${member}`);
    if (policy.signature !== "only" &&
        (!Number.isInteger(policy.signature) || policy.signature < 0)) {
      throw new Error(`${context} method policy ${member} requires signature "only" or an overload index`);
    }
    const omitted = policy.omittedOptionalParameters ?? [];
    if (!Array.isArray(omitted) || !omitted.every(nonemptyString) ||
        new Set(omitted).size !== omitted.length) {
      throw new Error(`${context} method policy ${member} has invalid omitted optional parameters`);
    }
  }
  for (const [id, exception] of Object.entries(generation.exceptions ?? {})) {
    if (!nonemptyString(id)) throw new Error(`${context} exception id must be non-empty`);
    validateException(exception, `${context} exception ${id}`);
  }
  return profile;
}

function typeProvenance(path, detail) {
  return { source: path, detail };
}

function translatedType(lean, representation, provenance, resourceInner = null) {
  return { lean, representation, provenance, resourceInner };
}

function nullableResource(shape, generation, profile, context) {
  const element = translateType(shape.element, generation, profile, context);
  if (element.representation !== "js-resource" || element.resourceInner === null) {
    throw new Error(`${context} nullable values require a JavaScript resource element`);
  }
  return translatedType(
    `${profile.resource.nullableConstructor} ${element.resourceInner}`,
    "js-resource",
    [
      ...element.provenance,
      typeProvenance(
        "generation.abiProfile.resource.nullableConstructor",
        `nullable resource constructor ${profile.resource.nullableConstructor}`,
      ),
    ],
    element.resourceInner,
  );
}

function translateType(shape, generation, profile, context) {
  if (shape?.kind === "primitive") {
    const type = profile.types[shape.name];
    if (type !== undefined) {
      const path = `generation.abiProfile.types.${shape.name}`;
      if (type.representation === "immediate") {
        return translatedType(
          type.lean,
          "immediate",
          [typeProvenance(path, `TypeScript ${shape.name} uses immediate Lean type ${type.lean}`)],
        );
      }
      return translatedType(
        `${profile.resource.constructor} ${type.lean}`,
        "js-resource",
        [
          typeProvenance(path, `TypeScript ${shape.name} uses JavaScript resource marker ${type.lean}`),
          typeProvenance(
            "generation.abiProfile.resource.constructor",
            `resource constructor ${profile.resource.constructor}`,
          ),
        ],
        type.lean,
      );
    }
  }
  if (shape?.kind === "option") return nullableResource(shape, generation, profile, context);
  if (shape?.kind === "ref" && nonemptyString(generation.resources?.[shape.id])) {
    const marker = generation.resources[shape.id];
    return translatedType(
      `${profile.resource.constructor} ${marker}`,
      "js-resource",
      [
        typeProvenance(`generation.resources.${shape.id}`, `TypeScript ${shape.id} uses Lean marker ${marker}`),
        typeProvenance(
          "generation.abiProfile.resource.constructor",
          `resource constructor ${profile.resource.constructor}`,
        ),
      ],
      marker,
    );
  }
  throw new Error(`${context} has unsupported faithful translation ${JSON.stringify(shape)}`);
}

export function leanType(shape, generation, context = "TypeScript shape") {
  return translateType(shape, generation, validateGenerationProfile(generation), context);
}

function exceptionFor(generation, operationId) {
  return generation.exceptions?.[operationId] ?? null;
}

function modalityArgument(name, role, type, defaults, provenanceBase, override = null) {
  const resource = type.representation === "js-resource";
  const passing = override?.passing ?? (resource ? defaults.passing : "value");
  const retention = override?.retention ?? (resource ? defaults.retention : "call");
  if (resource) {
    validatePassing(passing, `${name} argument`);
    validateRetention(retention, `${name} argument`);
  } else if (override !== null) {
    throw new Error(`${name} is immediate and cannot override resource passing or retention`);
  }
  if (passing === "borrowed" && retention !== "call") {
    throw new Error(`${name} cannot retain a borrowed resource beyond the call`);
  }
  return {
    name,
    role,
    type: type.lean,
    modalities: {
      representation: type.representation,
      passing,
      retention,
    },
    provenance: {
      type: type.provenance,
      passing: override?.passing === undefined
        ? typeProvenance(`${provenanceBase}.passing`, `default ${passing} passing`)
        : typeProvenance("generation.exceptions", `exception selects ${passing} passing`),
      retention: override?.retention === undefined
        ? typeProvenance(`${provenanceBase}.retention`, `default ${retention} retention`)
        : typeProvenance("generation.exceptions", `exception selects ${retention} retention`),
    },
  };
}

function receiverFor(member, identity, generation, profile, exception) {
  const owner = member.slice(0, member.lastIndexOf("."));
  const configuredGlobal = profile.receiver.globalTypes.includes(owner);
  const kind = exception?.receiver?.kind ?? (configuredGlobal ? "global" : "argument");
  if (!["global", "argument"].includes(kind)) {
    throw new Error(`${identity.id} receiver exception kind must be global or argument`);
  }
  if (kind === "global") {
    if (exception?.receiver?.passing !== undefined || exception?.receiver?.retention !== undefined) {
      throw new Error(`${identity.id} global receiver cannot define passing or retention`);
    }
    return {
      kind,
      typescriptType: owner,
      provenance: {
        kind: exception?.receiver?.kind === undefined
          ? typeProvenance(
            "generation.abiProfile.receiver.globalTypes",
            `${owner} is configured as a host-global receiver`,
          )
          : typeProvenance("generation.exceptions", exception.reason),
      },
    };
  }
  const marker = generation.resources?.[owner];
  if (!nonemptyString(marker)) {
    throw new Error(`${identity.id} has no Lean resource mapping for receiver ${owner}`);
  }
  const ownerName = owner.slice(owner.lastIndexOf(".") + 1);
  const name = leanBinderIdentifier(
    ownerName[0].toLowerCase() + ownerName.slice(1),
    `${identity.id} receiver name`,
  );
  const type = translatedType(
    `${profile.resource.constructor} ${marker}`,
    "js-resource",
    [typeProvenance(`generation.resources.${owner}`, `receiver uses Lean marker ${marker}`)],
    marker,
  );
  return {
    kind,
    typescriptType: owner,
    argument: modalityArgument(
      name,
      "receiver",
      type,
      profile.receiver.default,
      "generation.abiProfile.receiver.default",
      exception?.receiver ?? null,
    ),
  };
}

function resultFor(type, profile, exception) {
  const resource = type.representation === "js-resource";
  const ownership = exception?.result?.ownership ??
    (resource ? profile.resource.result.ownership : "value");
  if (resource && !["owned", "borrowed"].includes(ownership)) {
    throw new Error(`resource result ownership must be owned or borrowed`);
  }
  if (!resource && exception?.result !== undefined) {
    throw new Error(`immediate result cannot override resource ownership`);
  }
  return {
    lean: type.lean,
    modalities: { representation: type.representation, ownership },
    provenance: {
      type: type.provenance,
      ownership: exception?.result?.ownership === undefined
        ? typeProvenance(
          resource ? "generation.abiProfile.resource.result.ownership" : "typescript.result",
          resource ? `default ${ownership} resource result` : "immediate value result",
        )
        : typeProvenance("generation.exceptions", exception.reason),
    },
  };
}

function operationName(operation, namespace) {
  const prefix = `${namespace}.`;
  if (!operation.lean.startsWith(prefix)) {
    throw new Error(`${operation.lean} is outside generated namespace ${namespace}`);
  }
  const relativeName = operation.lean.slice(prefix.length);
  const separator = relativeName.lastIndexOf(".");
  if (separator <= 0 || separator === relativeName.length - 1) {
    throw new Error(`${operation.lean} must name a declaration in a nested namespace`);
  }
  const nestedNamespace = relativeName.slice(0, separator);
  for (const part of nestedNamespace.split(".")) {
    validateLeanIdentifier(part, `${operation.lean} namespace`);
  }
  return {
    namespace: nestedNamespace,
    name: validateLeanIdentifier(
      relativeName.slice(separator + 1),
      `${operation.lean} declaration`,
    ),
  };
}

function anchorFor(anchorsById, operation, member, accessor) {
  const anchor = anchorsById.get(operation.anchor);
  if (anchor === undefined) {
    throw new Error(`${member} ${accessor} references missing anchor ${operation.anchor}`);
  }
  const intent = anchor.portIntent;
  if (anchor.ts !== member || anchor.target !== operation.target ||
      anchor.relation !== "audit" || intent?.disposition !== "bind" ||
      intent.accessor !== accessor) {
    throw new Error(`${operation.anchor} is not a matching audited ${member} ${accessor}`);
  }
  return anchor;
}

function propertyOperation(
  config,
  root,
  mapping,
  symbol,
  accessor,
  operation,
  generation,
  profile,
  anchorsById,
) {
  const member = mapping.typescript;
  const anchor = anchorFor(anchorsById, operation, member, accessor);
  const exception = exceptionFor(generation, anchor.id);
  const shape = symbol.accessors?.[accessor];
  const leanName = operationName(operation, generation.namespace);
  const receiver = receiverFor(member, anchor, generation, profile, exception);
  const propertyName = member.slice(member.lastIndexOf(".") + 1);
  const propertyBinder = leanBinderIdentifier(
    propertyName,
    `${member} setter argument`,
  );
  const arguments_ = [];
  let result;
  if (accessor === "get") {
    result = resultFor(translateType(shape, generation, profile, `${member} getter`), profile, exception);
  } else {
    const value = translateType(shape, generation, profile, `${member} setter`);
    arguments_.push(modalityArgument(
      propertyBinder,
      "argument",
      value,
      profile.resource.argument,
      "generation.abiProfile.resource.argument",
      exception?.arguments?.[propertyName] ?? null,
    ));
    result = resultFor(
      translateType(
        { kind: "primitive", name: "void" },
        generation,
        profile,
        `${member} setter result`,
      ),
      profile,
      exception,
    );
  }
  const knownArgumentNames = new Set(accessor === "set" ? [propertyName] : []);
  for (const name of Object.keys(exception?.arguments ?? {})) {
    if (!knownArgumentNames.has(name)) {
      throw new Error(`${anchor.id} exception references missing argument ${name}`);
    }
  }
  return {
    id: anchor.id,
    library: config.id,
    group: root.id,
    typescript: {
      member,
      kind: "property",
      accessor,
      shape,
      source: symbol.source,
      display: symbol.display,
      documentation: symbol.hover,
    },
    host: { target: operation.target },
    lean: {
      declaration: operation.lean,
      namespace: leanName.namespace,
      name: leanName.name,
    },
    effect: {
      id: exception?.effect?.id ?? profile.effect.id,
      lean: exception?.effect?.lean ?? profile.effect.lean,
      provenance: exception?.effect === undefined
        ? typeProvenance("generation.abiProfile.effect", `default ${profile.effect.id} effect`)
        : typeProvenance("generation.exceptions", exception.reason),
    },
    receiver,
    arguments: arguments_,
    result,
    ...(exception === null ? {} : { exception: { reason: exception.reason } }),
  };
}

function selectedMethodShape(member, symbol, policy) {
  if (policy === undefined) {
    throw new Error(`${member} requires an explicit generation.methodPolicies entry`);
  }
  const signature = policy.signature;
  if (signature === "only") {
    if (symbol.shape?.kind !== "function") {
      throw new Error(`${member} policy requires exactly one TypeScript signature`);
    }
    return { shape: symbol.shape, provenance: "generation.methodPolicies.signature=only" };
  }
  if (!Number.isInteger(signature) || signature < 0 || symbol.shape?.kind !== "union") {
    throw new Error(`${member} policy selects overload ${signature}, but the descriptor is not overloaded`);
  }
  const shape = symbol.shape.options?.[signature];
  if (shape?.kind !== "function") {
    throw new Error(`${member} policy selects missing or non-function overload ${signature}`);
  }
  return { shape, provenance: `generation.methodPolicies.signature=${signature}` };
}

function methodOperation(config, root, mapping, symbol, generation, profile) {
  const member = mapping.typescript;
  if (mapping.targets?.length !== 1 || mapping.lean?.length !== 1) {
    throw new Error(`${member} generation requires exactly one host target and one Lean declaration`);
  }
  const target = mapping.targets[0];
  const operationId = target;
  const policy = generation.methodPolicies?.[member];
  const { shape, provenance: signatureProvenance } = selectedMethodShape(member, symbol, policy);
  const omitted = new Set(policy.omittedOptionalParameters ?? []);
  const knownParameters = new Set(shape.args.map((argument) => argument.name));
  for (const name of omitted) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy omits missing parameter ${name}`);
    if (argument.optional !== true) throw new Error(`${member} policy cannot omit required parameter ${name}`);
  }
  const exception = exceptionFor(generation, operationId);
  const arguments_ = [];
  let omittedTrailingParameter = false;
  for (const argument of shape.args) {
    if (argument.rest === true) throw new Error(`${member} rest parameter ${argument.name} is not supported`);
    if (argument.optional === true) {
      if (!omitted.has(argument.name)) {
        throw new Error(`${member} optional parameter ${argument.name} requires an explicit omission policy`);
      }
      omittedTrailingParameter = true;
      continue;
    }
    if (omittedTrailingParameter) {
      throw new Error(`${member} cannot omit an optional parameter before ${argument.name}`);
    }
    arguments_.push(modalityArgument(
      leanBinderIdentifier(argument.name, `${member} parameter`),
      "argument",
      translateType(argument.type, generation, profile, `${member} parameter ${argument.name}`),
      profile.resource.argument,
      "generation.abiProfile.resource.argument",
      exception?.arguments?.[argument.name] ?? null,
    ));
  }
  for (const name of Object.keys(exception?.arguments ?? {})) {
    if (!knownParameters.has(name) || omitted.has(name)) {
      throw new Error(`${operationId} exception references missing generated argument ${name}`);
    }
  }
  const receiver = receiverFor(member, { id: operationId }, generation, profile, exception);
  const leanName = operationName({ lean: mapping.lean[0] }, generation.namespace);
  const result = resultFor(
    translateType(shape.result, generation, profile, `${member} result`),
    profile,
    exception,
  );
  return {
    id: operationId,
    library: config.id,
    group: root.id,
    typescript: {
      member,
      kind: "method",
      shape,
      source: symbol.source,
      display: symbol.display,
      documentation: symbol.hover,
      signaturePolicy: {
        selection: policy.signature,
        omittedOptionalParameters: [...omitted],
        provenance: signatureProvenance,
      },
    },
    host: { target },
    lean: {
      declaration: mapping.lean[0],
      namespace: leanName.namespace,
      name: leanName.name,
    },
    effect: {
      id: exception?.effect?.id ?? profile.effect.id,
      lean: exception?.effect?.lean ?? profile.effect.lean,
      provenance: exception?.effect === undefined
        ? typeProvenance("generation.abiProfile.effect", `default ${profile.effect.id} effect`)
        : typeProvenance("generation.exceptions", exception.reason),
    },
    receiver,
    arguments: arguments_,
    result,
    ...(exception === null ? {} : { exception: { reason: exception.reason } }),
  };
}

export function buildGeneratedOperations(config, generation, descriptorsByRoot, {
  validateExceptions = true,
} = {}) {
  const profile = validateGenerationProfile(generation, `${config.id} generation`);
  const generatedMembers = new Set(generation.members);
  const mappings = new Map();
  for (const root of config.roots) {
    const anchorsById = new Map((root.anchors ?? []).map((anchor) => [anchor.id, anchor]));
    for (const mapping of root.mappings ?? []) {
      if (!generatedMembers.has(mapping.typescript)) continue;
      if (mappings.has(mapping.typescript)) {
        throw new Error(`generated member ${mapping.typescript} is mapped by more than one API group`);
      }
      mappings.set(mapping.typescript, { root, mapping, anchorsById });
    }
  }
  const symbolsByRoot = new Map([...descriptorsByRoot].map(([id, descriptor]) => [
    id,
    new Map(descriptor.symbols.map((symbol) => [symbol.id, symbol])),
  ]));
  const operations = [];
  for (const member of [...generation.members].sort()) {
    const entry = mappings.get(member);
    if (entry === undefined) throw new Error(`generated member ${member} has no reviewed mapping`);
    const descriptor = descriptorsByRoot.get(entry.root.id);
    if (descriptor === undefined) {
      if (validateExceptions) throw new Error(`generated member ${member} has no TypeScript descriptor`);
      continue;
    }
    const symbol = symbolsByRoot.get(entry.root.id).get(member);
    if (entry.mapping.accessors === undefined) {
      if (symbol?.kind !== "method") throw new Error(`${member} is not a TypeScript method`);
      operations.push(methodOperation(
        config,
        entry.root,
        entry.mapping,
        symbol,
        generation,
        profile,
      ));
      continue;
    }
    if (symbol?.kind !== "property") throw new Error(`${member} is not a TypeScript property`);
    if (symbol.optional === true) {
      throw new Error(`${member} is optional; optional property generation is not supported yet`);
    }
    for (const accessor of ["get", "set"]) {
      const operation = entry.mapping.accessors[accessor];
      const accessorType = symbol.accessors?.[accessor];
      if (accessorType !== undefined && (operation === undefined || operation.missing === true)) {
        throw new Error(`${member} ${accessor} is part of the TypeScript surface but has no generated binding`);
      }
      if (accessorType === undefined && operation !== undefined && operation.missing !== true) {
        throw new Error(`${member} maps a ${accessor} operation absent from the TypeScript surface`);
      }
      if (operation === undefined || operation.missing === true) continue;
      operations.push(propertyOperation(
        config,
        entry.root,
        entry.mapping,
        symbol,
        accessor,
        operation,
        generation,
        profile,
        entry.anchorsById,
      ));
    }
  }
  if (validateExceptions) {
    const operationIds = new Set(operations.map((operation) => operation.id));
    for (const id of Object.keys(generation.exceptions ?? {})) {
      if (!operationIds.has(id)) throw new Error(`generation exception ${id} matches no generated operation`);
    }
  }
  return operations;
}

function projectedPortIntent(anchor, operation) {
  for (const field of derivedPortIntentFields) {
    if (anchor.portIntent?.[field] !== undefined) {
      throw new Error(`${anchor.id} authors derived modality field portIntent.${field}`);
    }
  }
  const resourceArguments = operation.arguments.flatMap((argument, index) =>
    argument.modalities.representation === "js-resource" ? [index] : []);
  return {
    ...anchor.portIntent,
    effect: operation.effect.id,
    ...(operation.receiver.kind === "argument"
      ? { receiver: operation.receiver.argument.modalities.passing }
      : {}),
    ...(resourceArguments.length === 0 ? {} : { resourceArguments }),
    ...(operation.result.modalities.representation === "js-resource"
      ? { resultRepresentation: "hostResource" }
      : {}),
  };
}

function modalityContract(operation, profile) {
  return {
    source: "generated-operation-ir",
    profile: profile.id,
    operation: operation.id,
    effect: operation.effect,
    receiver: operation.receiver,
    arguments: operation.arguments,
    result: operation.result,
    ...(operation.exception === undefined ? {} : { exception: operation.exception }),
  };
}

export function materializeGeneratedAnchors(config, root, descriptor, anchorData) {
  if (config.generation === undefined) return anchorData;
  const operations = buildGeneratedOperations(
    config,
    config.generation,
    new Map([[root.id, descriptor]]),
    { validateExceptions: false },
  );
  const byAnchor = new Map(operations.map((operation) => [operation.id, operation]));
  return {
    ...anchorData,
    anchors: (anchorData.anchors ?? []).map((anchor) => {
      const operation = byAnchor.get(anchor.id);
      if (operation === undefined) return anchor;
      return {
        ...anchor,
        portIntent: projectedPortIntent(anchor, operation),
        modalityContract: modalityContract(operation, config.generation.abiProfile),
      };
    }),
  };
}

export function generatedOperationDocument(config, generation, operations) {
  return {
    format: "lean-vir-binding-operation-ir",
    version: 1,
    library: config.id,
    profile: generation.abiProfile,
    operations,
  };
}
