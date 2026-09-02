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

function validateUpstreamSemantics(value, context) {
  if (!["preserving", "changing"].includes(value)) {
    throw new Error(`${context} semantics must be preserving or changing`);
  }
}

function validateActiveEffect(value, context) {
  if (!["register", "use", "release"].includes(value)) {
    throw new Error(`${context} activeEffect must be register, use, or release`);
  }
}

function validateSemanticPolicy(value, context, additionalFields = []) {
  if (!object(value) || !nonemptyString(value.reason)) {
    throw new Error(`${context} must define semantics and reason`);
  }
  validateKeys(value, ["semantics", "reason", ...additionalFields], context);
  validateUpstreamSemantics(value.semantics, context);
}

function typeLeaf(value) {
  return value.slice(value.lastIndexOf(".") + 1);
}

function resourceMapping(generation, id, context = `generation resource ${id}`) {
  const mapping = generation.resources?.[id];
  if (typeof mapping === "string") {
    if (!nonemptyString(mapping) || typeLeaf(id) !== typeLeaf(mapping)) {
      throw new Error(
        `${context} changes the TypeScript marker and requires lean, semantics, and reason`,
      );
    }
    return {
      lean: mapping,
      semantics: "preserving",
      reason: `${mapping} preserves the TypeScript ${id} phantom marker.`,
      explicit: false,
    };
  }
  if (mapping === undefined) return null;
  if (!object(mapping) || !nonemptyString(mapping.lean)) {
    throw new Error(`${context} must define a Lean marker`);
  }
  validateSemanticPolicy(mapping, context, ["lean"]);
  return { ...mapping, explicit: true };
}

function validateKeys(value, allowed, context) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${context} has unsupported field ${key}`);
  }
}

function validateTypeOverride(value, context) {
  if (!object(value) || !nonemptyString(value.lean) ||
      !["immediate", "lean-owned", "js-resource", "callback"].includes(value.representation)) {
    throw new Error(`${context} must define a Lean type and representation`);
  }
  validateKeys(value, ["lean", "representation", "resourceInner"], context);
  if (value.resourceInner !== undefined && !nonemptyString(value.resourceInner)) {
    throw new Error(`${context} resourceInner must be non-empty`);
  }
  if (value.representation !== "js-resource" && value.resourceInner !== undefined) {
    throw new Error(`${context} resourceInner is only valid for JavaScript resources`);
  }
}

function validateModalityOverride(value, context, { receiver = false } = {}) {
  if (!object(value)) throw new Error(`${context} must be an object`);
  if (Object.keys(value).length === 0) throw new Error(`${context} must select a modality`);
  validateKeys(
    value,
    receiver
      ? ["kind", "passing", "retention", "name", "type"]
      : ["role", "passing", "retention", "type"],
    context,
  );
  if (!receiver && value.role !== undefined && !["argument", "callback"].includes(value.role)) {
    throw new Error(`${context} role must be argument or callback`);
  }
  if (value.passing !== undefined) validatePassing(value.passing, context);
  if (value.retention !== undefined) validateRetention(value.retention, context);
  if (value.type !== undefined) validateTypeOverride(value.type, `${context} type`);
  if (receiver && value.kind !== undefined && !["global", "argument", "none"].includes(value.kind)) {
    throw new Error(`${context} kind must be global, argument, or none`);
  }
  if (receiver && value.name !== undefined && !nonemptyString(value.name)) {
    throw new Error(`${context} name must be non-empty`);
  }
}

function validateException(exception, context) {
  if (!object(exception) || !nonemptyString(exception.reason)) {
    throw new Error(`${context} requires a reason`);
  }
  validateKeys(
    exception,
    ["reason", "semantics", "activeEffect", "receiver", "arguments", "result", "effect"],
    context,
  );
  if (exception.semantics !== undefined) {
    validateUpstreamSemantics(exception.semantics, context);
  }
  if (exception.activeEffect !== undefined) {
    validateActiveEffect(exception.activeEffect, context);
  }
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
    validateKeys(exception.result, ["ownership", "type"], `${context} result`);
    if (exception.result.ownership !== undefined &&
        !["owned", "borrowed"].includes(exception.result.ownership)) {
      throw new Error(`${context} result ownership must be owned or borrowed`);
    }
    if (exception.result.type !== undefined) {
      validateTypeOverride(exception.result.type, `${context} result type`);
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
      !object(profile.receiver.globalTypes) || !object(generation.resources)) {
    throw new Error(`${context} does not define a valid ABI profile`);
  }
  for (const [name, policy] of Object.entries(profile.receiver.globalTypes)) {
    if (!nonemptyString(name)) throw new Error(`${context} global receiver type is empty`);
    validateSemanticPolicy(policy, `${context} global receiver ${name}`);
  }
  for (const id of Object.keys(generation.resources)) {
    if (!nonemptyString(id)) throw new Error(`${context} resource type is empty`);
    resourceMapping(generation, id, `${context} resource ${id}`);
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
    validateKeys(
      policy,
      [
        "signature",
        "omittedOptionalParameters",
        "omittedRequiredParameters",
        "omittedRestParameters",
        "fixedRestParameters",
        "fixedArguments",
        "parameterRenames",
        "semantics",
        "reason",
      ],
      `${context} method policy ${member}`,
    );
    if (policy.signature !== "only" &&
        (!Number.isInteger(policy.signature) || policy.signature < 0)) {
      throw new Error(`${context} method policy ${member} requires signature "only" or an overload index`);
    }
    const omitted = policy.omittedOptionalParameters ?? [];
    if (!Array.isArray(omitted) || !omitted.every(nonemptyString) ||
        new Set(omitted).size !== omitted.length) {
      throw new Error(`${context} method policy ${member} has invalid omitted optional parameters`);
    }
    const omittedRequired = policy.omittedRequiredParameters ?? [];
    if (!Array.isArray(omittedRequired) || !omittedRequired.every(nonemptyString) ||
        new Set(omittedRequired).size !== omittedRequired.length) {
      throw new Error(`${context} method policy ${member} has invalid omitted required parameters`);
    }
    const omittedRest = policy.omittedRestParameters ?? [];
    if (!Array.isArray(omittedRest) || !omittedRest.every(nonemptyString) ||
        new Set(omittedRest).size !== omittedRest.length) {
      throw new Error(`${context} method policy ${member} has invalid omitted rest parameters`);
    }
    const fixedRest = policy.fixedRestParameters ?? {};
    if (!object(fixedRest) || !Object.keys(fixedRest).every(nonemptyString) ||
        !Object.values(fixedRest).every((names) =>
      Array.isArray(names) && names.length !== 0 && names.every(nonemptyString) &&
      new Set(names).size === names.length)) {
      throw new Error(`${context} method policy ${member} has invalid fixed rest parameters`);
    }
    const fixedArguments = policy.fixedArguments ?? {};
    if (!object(fixedArguments) || !Object.keys(fixedArguments).every(nonemptyString) ||
        !Object.values(fixedArguments).every((value) =>
          ["string", "number", "boolean"].includes(typeof value))) {
      throw new Error(`${context} method policy ${member} has invalid fixed arguments`);
    }
    const parameterRenames = policy.parameterRenames ?? {};
    if (!object(parameterRenames) || !Object.keys(parameterRenames).every(nonemptyString) ||
        !Object.values(parameterRenames).every(nonemptyString) ||
        new Set(Object.values(parameterRenames)).size !== Object.keys(parameterRenames).length) {
      throw new Error(`${context} method policy ${member} has invalid parameter renames`);
    }
    if ((policy.semantics === undefined) !== (policy.reason === undefined)) {
      throw new Error(`${context} method policy ${member} must define semantics and reason together`);
    }
    if (policy.semantics !== undefined &&
        !["preserving", "changing"].includes(policy.semantics)) {
      throw new Error(`${context} method policy ${member} has invalid semantics`);
    }
    if (policy.reason !== undefined && !nonemptyString(policy.reason)) {
      throw new Error(`${context} method policy ${member} has invalid reason`);
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

function overriddenType(override, context, source = "generation.exceptions") {
  validateTypeOverride(override, context);
  return translatedType(
    override.lean,
    override.representation,
    [typeProvenance(source, `explicit Lean type ${override.lean}`)],
    override.resourceInner ?? null,
  );
}

function operationType(shape, override, generation, profile, context) {
  return override?.type === undefined
    ? translateType(shape, generation, profile, context)
    : overriddenType(override.type, `${context} override`);
}

function nullableResource(shape, generation, profile, context) {
  const absence = shape.absence;
  if (absence === undefined) {
    throw new Error(`${context} option is missing TypeScript absence provenance`);
  }
  if (absence !== "null") {
    throw new Error(
      `${context} uses TypeScript ${absence} absence; only null-backed nullable resources are supported`,
    );
  }
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
  if (shape?.kind === "ref") {
    const mapping = resourceMapping(generation, shape.id, `${context} resource ${shape.id}`);
    if (mapping === null) {
      throw new Error(`${context} has unsupported faithful translation ${JSON.stringify(shape)}`);
    }
    const marker = mapping.lean;
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

function methodPolicyChangesCall(policy) {
  return policy.signature !== "only" ||
    (policy.omittedOptionalParameters?.length ?? 0) !== 0 ||
    (policy.omittedRequiredParameters?.length ?? 0) !== 0 ||
    (policy.omittedRestParameters?.length ?? 0) !== 0 ||
    Object.keys(policy.fixedRestParameters ?? {}).length !== 0 ||
    Object.keys(policy.fixedArguments ?? {}).length !== 0;
}

function combineSemantics(primary, policyFacts) {
  if (primary.relation === "unreviewed") return primary;
  const changing = policyFacts.filter((fact) => fact.relation === "changing");
  if (changing.length === 0) return primary;
  const details = [...new Set([
    ...(primary.relation === "changing" ? [primary.detail] : []),
    ...changing.map((fact) => fact.detail),
  ])];
  return {
    relation: "changing",
    evidence: primary.relation === "changing" ? primary.evidence : "abi-policy",
    detail: details.join(" "),
  };
}

function typePolicyFacts(shape, generation, context) {
  if (shape?.kind === "option") {
    return typePolicyFacts(shape.element, generation, context);
  }
  if (shape?.kind === "ref") {
    const mapping = resourceMapping(generation, shape.id, `${context} resource ${shape.id}`);
    return mapping?.explicit === true
      ? [{
        relation: mapping.semantics,
        evidence: "resource-mapping",
        detail: mapping.reason,
      }]
      : [];
  }
  return [];
}

function receiverPolicyFacts(member, generation, profile, { free = false } = {}) {
  if (free) return [];
  const owner = member.slice(0, member.lastIndexOf("."));
  const globalPolicy = profile.receiver.globalTypes[owner];
  if (globalPolicy !== undefined) {
    return [{
      relation: globalPolicy.semantics,
      evidence: "global-receiver-policy",
      detail: globalPolicy.reason,
    }];
  }
  const mapping = resourceMapping(generation, owner, `${member} receiver resource ${owner}`);
  return mapping?.explicit === true
    ? [{
      relation: mapping.semantics,
      evidence: "resource-mapping",
      detail: mapping.reason,
    }]
    : [];
}

function derivedSemantics(exception, methodPolicy = null, policyFacts = []) {
  let primary;
  if (exception === null && methodPolicy?.semantics !== undefined) {
    primary = {
      relation: methodPolicy.semantics,
      evidence: "reviewed-method-policy",
      detail: methodPolicy.reason,
    };
  } else if (exception === null && methodPolicy !== null && methodPolicyChangesCall(methodPolicy)) {
    primary = {
      relation: "unreviewed",
      evidence: "method-policy",
      detail: "The method policy changes overload selection or the exposed call surface without a semantic classification.",
    };
  } else if (exception === null) {
    primary = {
      relation: "preserving",
      evidence: "typescript-derived",
      detail: "The canonical operation is derived from the TypeScript declaration and ABI profile without an operation exception.",
    };
  } else if (exception.semantics === undefined) {
    primary = {
      relation: "unreviewed",
      evidence: "operation-exception",
      detail: exception.reason,
    };
  } else {
    primary = {
      relation: exception.semantics,
      evidence: "reviewed-exception",
      detail: exception.reason,
    };
  }
  return combineSemantics(primary, policyFacts);
}

function protocolSemantics(protocol) {
  const relation = protocol.upstreamRelation;
  if (relation.kind === "vir-owned") {
    return { relation: "vir-owned", evidence: "protocol-relation", detail: protocol.reason };
  }
  if (relation.kind === "local-contract") {
    return { relation: "local-contract", evidence: "protocol-relation", detail: protocol.reason };
  }
  if (relation.kind === "upstream-adapter" && relation.semantics !== undefined) {
    return {
      relation: relation.semantics,
      evidence: "reviewed-protocol",
      detail: protocol.reason,
    };
  }
  return {
    relation: "unreviewed",
    evidence: relation.kind === "upstream-adapter" ? "upstream-adapter" : "unclassified",
    detail: protocol.reason,
  };
}

function modalityArgument(
  name,
  role,
  type,
  defaults,
  provenanceBase,
  override = null,
  overrideSource = "generation.exceptions",
) {
  const resource = type.representation === "js-resource" ||
    type.representation === "callback" || type.representation === "lean-owned";
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
        : typeProvenance(overrideSource, `explicit policy selects ${passing} passing`),
      retention: override?.retention === undefined
        ? typeProvenance(`${provenanceBase}.retention`, `default ${retention} retention`)
        : typeProvenance(overrideSource, `explicit policy selects ${retention} retention`),
    },
  };
}

function receiverFor(member, identity, generation, profile, exception, defaultName = undefined) {
  const owner = member.slice(0, member.lastIndexOf("."));
  const configuredGlobal = profile.receiver.globalTypes[owner] !== undefined;
  const kind = exception?.receiver?.kind ?? (configuredGlobal ? "global" : "argument");
  if (!["global", "argument", "none"].includes(kind)) {
    throw new Error(`${identity.id} receiver exception kind must be global, argument, or none`);
  }
  if (kind === "none") {
    if (["passing", "retention", "name", "type"].some((field) =>
      exception?.receiver?.[field] !== undefined)) {
      throw new Error(`${identity.id} absent receiver cannot define a name, type, or modalities`);
    }
    return {
      kind,
      typescriptType: owner,
      provenance: {
        kind: typeProvenance("generation.exceptions", exception.reason),
      },
    };
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
  const ownerName = owner.slice(owner.lastIndexOf(".") + 1);
  const name = leanBinderIdentifier(
    exception?.receiver?.name ?? defaultName ?? ownerName[0].toLowerCase() + ownerName.slice(1),
    `${identity.id} receiver name`,
  );
  const marker = resourceMapping(generation, owner, `${identity.id} receiver resource ${owner}`)?.lean;
  const type = exception?.receiver?.type === undefined
    ? (() => {
      if (!nonemptyString(marker)) {
        throw new Error(`${identity.id} has no Lean resource mapping for receiver ${owner}`);
      }
      return translatedType(
        `${profile.resource.constructor} ${marker}`,
        "js-resource",
        [typeProvenance(`generation.resources.${owner}`, `receiver uses Lean marker ${marker}`)],
        marker,
      );
    })()
    : overriddenType(exception.receiver.type, `${identity.id} receiver type`);
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

function resultFor(type, profile, exception, overrideSource = "generation.exceptions") {
  const resource = type.representation === "js-resource" || type.representation === "callback";
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
        : typeProvenance(
          overrideSource,
          exception.reason ?? `explicit policy selects ${ownership} ownership`,
        ),
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
  if (operation.anchor === undefined) {
    return {
      id: operation.target,
      ts: member,
      target: operation.target,
      relation: "audit",
      portIntent: { disposition: "bind", accessor },
    };
  }
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
  if (accessor === "get" && operation.parameterName !== undefined) {
    throw new Error(`${member} getter cannot define a setter parameter name`);
  }
  const receiver = receiverFor(
    member,
    anchor,
    generation,
    profile,
    exception,
    operation.receiverName,
  );
  if (operation.receiverName !== undefined && receiver.kind !== "argument") {
    throw new Error(`${member} ${accessor} cannot name an absent receiver`);
  }
  const propertyName = member.slice(member.lastIndexOf(".") + 1);
  const propertyParameterName = operation.parameterName ?? propertyName;
  const propertyBinder = leanBinderIdentifier(
    propertyParameterName,
    `${member} setter argument`,
  );
  const arguments_ = [];
  let result;
  if (accessor === "get") {
    result = resultFor(
      operationType(shape, exception?.result, generation, profile, `${member} getter`),
      profile,
      exception,
    );
  } else {
    const value = operationType(
      shape,
      exception?.arguments?.[propertyParameterName],
      generation,
      profile,
      `${member} setter`,
    );
    arguments_.push(modalityArgument(
      propertyBinder,
      "argument",
      value,
      profile.resource.argument,
      "generation.abiProfile.resource.argument",
      exception?.arguments?.[propertyParameterName] ?? null,
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
  const knownArgumentNames = new Set(accessor === "set" ? [propertyParameterName] : []);
  for (const name of Object.keys(exception?.arguments ?? {})) {
    if (!knownArgumentNames.has(name)) {
      throw new Error(`${anchor.id} exception references missing argument ${name}`);
    }
  }
  const semanticFacts = [
    ...receiverPolicyFacts(member, generation, profile),
    ...typePolicyFacts(shape, generation, `${member} ${accessor}`),
  ];
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
    semantics: derivedSemantics(exception, null, semanticFacts),
    ...(exception?.activeEffect === undefined ? {} : { activeEffect: exception.activeEffect }),
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

function methodOperation(config, root, mapping, symbol, generation, profile, { free = false } = {}) {
  const member = mapping.typescript;
  if (mapping.targets?.length !== 1 || mapping.lean?.length !== 1) {
    throw new Error(`${member} generation requires exactly one host target and one Lean declaration`);
  }
  const target = mapping.targets[0];
  const operationId = target;
  const policy = generation.methodPolicies?.[member];
  const { shape, provenance: signatureProvenance } = selectedMethodShape(member, symbol, policy);
  const omitted = new Set(policy.omittedOptionalParameters ?? []);
  const omittedRequired = new Set(policy.omittedRequiredParameters ?? []);
  const omittedRest = new Set(policy.omittedRestParameters ?? []);
  const fixedRest = policy.fixedRestParameters ?? {};
  const fixedArguments = policy.fixedArguments ?? {};
  const parameterRenames = policy.parameterRenames ?? {};
  const exception = exceptionFor(generation, operationId);
  if (policy.semantics !== undefined && exception !== null) {
    throw new Error(
      `${member} cannot classify semantics in both its method policy and operation exception`,
    );
  }
  for (const name of omitted) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy omits missing parameter ${name}`);
    if (argument.optional !== true) throw new Error(`${member} policy cannot omit required parameter ${name}`);
  }
  for (const name of omittedRest) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy omits missing rest parameter ${name}`);
    if (argument.rest !== true) throw new Error(`${member} policy cannot rest-omit non-rest parameter ${name}`);
    if (fixedRest[name] !== undefined) {
      throw new Error(`${member} policy cannot both omit and fix rest parameter ${name}`);
    }
  }
  for (const name of omittedRequired) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy omits missing required parameter ${name}`);
    if (argument.optional === true || argument.rest === true) {
      throw new Error(`${member} policy cannot required-omit optional or rest parameter ${name}`);
    }
  }
  if (omittedRequired.size !== 0 && exception === null) {
    throw new Error(`${member} required parameter omission requires a justified generation exception`);
  }
  for (const [name, value] of Object.entries(fixedArguments)) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy fixes missing parameter ${name}`);
    if (argument.rest === true || argument.type?.kind !== "literal" ||
        !Object.is(argument.type.value, value)) {
      throw new Error(`${member} fixed argument ${name} does not match its TypeScript literal`);
    }
    if (omitted.has(name) || omittedRequired.has(name)) {
      throw new Error(`${member} policy cannot both omit and fix parameter ${name}`);
    }
  }
  if (Object.keys(fixedArguments).length !== 0 && exception === null) {
    throw new Error(`${member} fixed arguments require a justified generation exception`);
  }
  for (const name of Object.keys(fixedRest)) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy fixes missing rest parameter ${name}`);
    if (argument.rest !== true) throw new Error(`${member} policy cannot fix non-rest parameter ${name}`);
    if (argument.type?.kind !== "array") {
      throw new Error(`${member} fixed rest parameter ${name} must have an array element type`);
    }
  }
  for (const [name, renamed] of Object.entries(parameterRenames)) {
    const argument = shape.args.find((candidate) => candidate.name === name);
    if (argument === undefined) throw new Error(`${member} policy renames missing parameter ${name}`);
    if (argument.rest === true) {
      throw new Error(`${member} policy must name fixed rest binders in fixedRestParameters`);
    }
    if (omitted.has(name) || omittedRequired.has(name)) {
      throw new Error(`${member} policy cannot rename omitted parameter ${name}`);
    }
    if (Object.hasOwn(fixedArguments, name)) {
      throw new Error(`${member} policy cannot rename fixed parameter ${name}`);
    }
    leanBinderIdentifier(renamed, `${member} renamed parameter`);
  }
  const arguments_ = [];
  const knownParameters = new Set();
  function addArgument(name, typeShape) {
    if (knownParameters.has(name)) {
      throw new Error(`${member} generates duplicate parameter ${name}`);
    }
    knownParameters.add(name);
    arguments_.push(modalityArgument(
      leanBinderIdentifier(name, `${member} parameter`),
      exception?.arguments?.[name]?.role ?? "argument",
      operationType(
        typeShape,
        exception?.arguments?.[name],
        generation,
        profile,
        `${member} parameter ${name}`,
      ),
      profile.resource.argument,
      "generation.abiProfile.resource.argument",
      exception?.arguments?.[name] ?? null,
    ));
  }
  let omittedTrailingParameter = false;
  for (const argument of shape.args) {
    if (argument.rest === true) {
      if (omittedRest.has(argument.name)) continue;
      const fixedNames = fixedRest[argument.name];
      if (fixedNames === undefined) {
        throw new Error(`${member} rest parameter ${argument.name} requires an explicit omission or fixed-arity policy`);
      }
      for (const name of fixedNames) addArgument(name, argument.type.element);
      continue;
    }
    if (omittedRequired.has(argument.name)) continue;
    if (Object.hasOwn(fixedArguments, argument.name)) continue;
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
    addArgument(parameterRenames[argument.name] ?? argument.name, argument.type);
  }
  for (const name of Object.keys(exception?.arguments ?? {})) {
    if (!knownParameters.has(name)) {
      throw new Error(`${operationId} exception references missing generated argument ${name}`);
    }
  }
  if (free && exception?.receiver !== undefined && exception.receiver.kind !== "none") {
    throw new Error(`${operationId} free-function receiver exception must select none`);
  }
  const receiver = free
    ? {
      kind: "none",
      provenance: {
        kind: typeProvenance("typescript.kind", "TypeScript free function has no receiver"),
      },
    }
    : receiverFor(
      member,
      { id: operationId },
      generation,
      profile,
      exception,
      mapping.receiverName,
    );
  const leanName = operationName({ lean: mapping.lean[0] }, generation.namespace);
  const result = resultFor(
    operationType(shape.result, exception?.result, generation, profile, `${member} result`),
    profile,
    exception,
  );
  const semanticFacts = [
    ...receiverPolicyFacts(member, generation, profile, { free }),
    ...shape.args.flatMap((argument) =>
      typePolicyFacts(argument.type, generation, `${member} argument ${argument.name}`)),
    ...typePolicyFacts(shape.result, generation, `${member} result`),
  ];
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
        omittedRequiredParameters: [...omittedRequired],
        omittedRestParameters: [...omittedRest],
        fixedRestParameters: structuredClone(fixedRest),
        fixedArguments: structuredClone(fixedArguments),
        parameterRenames: structuredClone(parameterRenames),
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
    semantics: derivedSemantics(exception, policy, semanticFacts),
    ...(exception?.activeEffect === undefined ? {} : { activeEffect: exception.activeEffect }),
    ...(exception === null ? {} : { exception: { reason: exception.reason } }),
  };
}

function functionOperation(config, root, mapping, symbol, generation, profile) {
  const operation = methodOperation(
    config,
    root,
    mapping,
    symbol,
    generation,
    profile,
    { free: true },
  );
  return {
    ...operation,
    typescript: { ...operation.typescript, kind: "function" },
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
      if (symbol?.kind === "method") {
        operations.push(methodOperation(
          config,
          entry.root,
          entry.mapping,
          symbol,
          generation,
          profile,
        ));
      } else if (symbol?.kind === "function") {
        operations.push(functionOperation(
          config,
          entry.root,
          entry.mapping,
          symbol,
          generation,
          profile,
        ));
      } else {
        throw new Error(`${member} is not a TypeScript method or function`);
      }
      continue;
    }
    if (symbol?.kind !== "property") throw new Error(`${member} is not a TypeScript property`);
    if (symbol.optional === true) {
      throw new Error(`${member} is optional; optional property generation is not supported yet`);
    }
    for (const accessor of ["get", "set"]) {
      const operation = entry.mapping.accessors[accessor];
      const accessorType = symbol.accessors?.[accessor];
      if (accessorType !== undefined && operation === undefined) {
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
  const groups = new Set(config.roots.map((root) => root.id));
  const rootsById = new Map(config.roots.map((root) => [root.id, root]));
  const operationIds = new Set(operations.map((operation) => operation.id));
  const targets = new Set(operations.map((operation) => operation.host.target));
  for (const protocol of generation.protocolOperations ?? []) {
    if (!groups.has(protocol.group)) {
      throw new Error(`generated protocol ${protocol.id} references unknown API group ${protocol.group}`);
    }
    if (operationIds.has(protocol.id)) throw new Error(`generated operation id ${protocol.id} is repeated`);
    if (targets.has(protocol.target)) throw new Error(`generated host target ${protocol.target} is repeated`);
    if (protocol.activeEffect !== undefined) {
      validateActiveEffect(protocol.activeEffect, `generated protocol ${protocol.id}`);
    }
    const root = rootsById.get(protocol.group);
    const relation = protocol.upstreamRelation;
    if (root.upstream.kind === "internal" && relation.kind !== "vir-owned") {
      throw new Error(`generated protocol ${protocol.id} in an internal group must be classified vir-owned`);
    }
    if (root.upstream.kind === "local" && relation.kind !== "local-contract") {
      throw new Error(`generated protocol ${protocol.id} in a local group must be classified local-contract`);
    }
    if (root.upstream.kind === "typescript" && relation.kind === "local-contract") {
      throw new Error(`generated protocol ${protocol.id} in a TypeScript group cannot be classified local-contract`);
    }
    if (relation.kind === "local-contract") {
      const symbols = symbolsByRoot.get(protocol.group);
      if (symbols !== undefined || validateExceptions) {
        if (!symbols?.has(relation.member)) {
          throw new Error(`generated protocol ${protocol.id} references missing local contract member ${relation.member}`);
        }
      }
    }
    if (relation.kind === "upstream-adapter") {
      if (relation.semantics !== undefined) {
        validateUpstreamSemantics(
          relation.semantics,
          `generated protocol ${protocol.id}`,
        );
      }
      if (root.upstream.kind !== "typescript") {
        throw new Error(`generated protocol ${protocol.id} can only adapt a TypeScript upstream member`);
      }
      const symbols = symbolsByRoot.get(protocol.group);
      // Descriptor generation materializes one API group at a time. Full
      // generation and the explorer always validate every named adapter.
      if (symbols !== undefined || validateExceptions) {
        if (!symbols?.has(relation.member)) {
          throw new Error(`generated protocol ${protocol.id} adapts missing TypeScript member ${relation.member}`);
        }
        const symbol = symbols.get(relation.member);
        if (relation.accessor !== undefined && symbol.kind !== "property") {
          throw new Error(`generated protocol ${protocol.id} classifies an accessor for non-property ${relation.member}`);
        }
        if (relation.accessor !== undefined && symbol.accessors?.[relation.accessor] === undefined) {
          throw new Error(`generated protocol ${protocol.id} classifies missing ${relation.accessor} accessor ${relation.member}`);
        }
      }
    }
    const typeParameters = protocol.typeParameters ?? [];
    if (new Set(typeParameters).size !== typeParameters.length) {
      throw new Error(`generated protocol ${protocol.id} repeats a type parameter`);
    }
    for (const parameter of typeParameters) {
      validateLeanIdentifier(parameter, `${protocol.id} type parameter`);
    }
    const args = protocol.arguments.map((argument) => {
      const type = overriddenType(
        argument.type,
        `${protocol.id} argument ${argument.name}`,
        "generation.protocolOperations",
      );
      return modalityArgument(
        leanBinderIdentifier(argument.name, `${protocol.id} argument`),
        argument.role ?? "argument",
        type,
        profile.resource.argument,
        "generation.abiProfile.resource.argument",
        argument.passing === undefined && argument.retention === undefined
          ? null
          : {
            ...(argument.passing === undefined ? {} : { passing: argument.passing }),
            ...(argument.retention === undefined ? {} : { retention: argument.retention }),
          },
        "generation.protocolOperations",
      );
    });
    const resultType = overriddenType(
      protocol.result.type,
      `${protocol.id} result`,
      "generation.protocolOperations",
    );
    const result = resultFor(
      resultType,
      profile,
      protocol.result.ownership === undefined
        ? null
        : { result: { ownership: protocol.result.ownership } },
      "generation.protocolOperations",
    );
    const leanName = operationName({ lean: protocol.lean }, generation.namespace);
    operations.push({
      id: protocol.id,
      library: config.id,
      group: protocol.group,
      typescript: {
        member: protocol.id,
        kind: "protocol",
        display: protocol.id,
        documentation: protocol.documentation ?? protocol.reason,
        source: null,
      },
      protocol: {
        reason: protocol.reason,
        upstreamRelation: structuredClone(protocol.upstreamRelation),
      },
      host: { target: protocol.target, marker: protocol.marker },
      lean: {
        declaration: protocol.lean,
        namespace: leanName.namespace,
        name: leanName.name,
      },
      effect: {
        ...protocol.effect,
        provenance: typeProvenance("generation.protocolOperations.effect", "explicit protocol effect"),
      },
      typeParameters,
      receiver: {
        kind: "none",
        provenance: {
          kind: typeProvenance("generation.protocolOperations", "protocol arguments are explicit"),
        },
      },
      arguments: args,
      result,
      semantics: protocolSemantics(protocol),
      ...(protocol.activeEffect === undefined ? {} : { activeEffect: protocol.activeEffect }),
    });
    operationIds.add(protocol.id);
    targets.add(protocol.target);
  }
  return operations;
}

function projectedPortIntent(anchor, operation) {
  for (const field of derivedPortIntentFields) {
    if (anchor.portIntent?.[field] !== undefined) {
      throw new Error(`${anchor.id} authors derived modality field portIntent.${field}`);
    }
  }
  const protocolReceiver = operation.arguments.find((argument) => argument.role === "receiver");
  const resourceArguments = operation.arguments.flatMap((argument, index) =>
    argument.role !== "receiver" && argument.modalities.representation === "js-resource"
      ? [index]
      : []);
  return {
    ...anchor.portIntent,
    effect: operation.effect.id,
    ...(operation.receiver.kind === "argument"
      ? { receiver: operation.receiver.argument.modalities.passing }
      : protocolReceiver === undefined
        ? {}
        : { receiver: protocolReceiver.modalities.passing }),
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
    semantics: operation.semantics,
    ...(operation.activeEffect === undefined ? {} : { activeEffect: operation.activeEffect }),
    ...(operation.protocol === undefined ? {} : { protocol: operation.protocol }),
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
  const byCorrespondence = new Map(operations
    .filter((operation) => operation.typescript.kind !== "protocol")
    .map((operation) => [
      `${operation.typescript.member}\u0000${operation.host.target}`,
      operation,
    ]));
  const byTarget = new Map(operations.map((operation) => [operation.host.target, operation]));
  return {
    ...anchorData,
    anchors: (anchorData.anchors ?? []).map((anchor) => {
      const operation = byAnchor.get(anchor.id) ??
        byCorrespondence.get(`${anchor.ts}\u0000${anchor.target}`) ??
        byTarget.get(anchor.target);
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
    version: 2,
    library: config.id,
    profile: generation.abiProfile,
    operations,
  };
}
