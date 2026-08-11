export function requireController(value, exampleId) {
  if (!value || typeof value !== "object") {
    throw new Error(`${exampleId} controller did not return an object`);
  }
  if (!value.ready || typeof value.ready.then !== "function") {
    throw new Error(`${exampleId} controller has no readiness promise`);
  }
  for (const method of ["getBackends", "runStudy"]) {
    if (typeof value[method] !== "function") {
      throw new Error(`${exampleId} controller does not implement ${method}()`);
    }
  }
  return value;
}
