const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isIdentifier(value) {
  return typeof value === "string" && identifierPattern.test(value);
}

export function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function exactProperties(value, allowed, label) {
  const unknown = Object.keys(value).find((property) => !allowed.has(property));
  if (unknown) throw new Error(`${label} has unknown property ${unknown}`);
}

export function exactObject(value, properties, label) {
  const selected = object(value, label);
  exactProperties(selected, new Set(properties), label);
  return selected;
}

export function string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function identifier(value, label) {
  if (!isIdentifier(value)) throw new Error(`${label} is not a safe identifier`);
  return value;
}
