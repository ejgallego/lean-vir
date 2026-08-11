import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { safeArchivePath } from "./artifact-set-lib.mjs";
import { discoverExampleCatalog } from "./example-catalog-lib.mjs";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const revisionPattern = /^[0-9a-f]{40}$/;
const producerProtocol = "browser-benchmarks/source-package/v1";
const artifactBoundary = "browser-benchmarks/bounded-runtime/v1";
const adapters = new Set(["vir", "fir-native", "fir-llvm"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new Error(`${label} is not a safe identifier`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function source(database, sourceId, label) {
  const value = database.sources[sourceId];
  if (!value) throw new Error(`${label} references unknown source ${sourceId}`);
  return value;
}

function materializeSource(database, value, label) {
  const sourceRef = identifier(value.sourceRef, `${label}.sourceRef`);
  const selected = source(database, sourceRef, label);
  const { sourceRef: _sourceRef, ...rest } = value;
  return {
    repository: selected.repository,
    commit: selected.revision,
    ...rest,
  };
}

function materializeComponent(database, component) {
  const artifact = structuredClone(component.artifact);
  if (component.producer.adapter !== "vir") return artifact;
  const runtimeSource = source(
    database,
    identifier(artifact.runtime.sourceRef, "vir runtime sourceRef"),
    "vir runtime",
  );
  const { sourceRef: _runtimeSourceRef, ...runtime } = artifact.runtime;
  artifact.runtime = {
    ...runtime,
    repository: runtimeSource.repository,
    sourceCommit: runtimeSource.revision,
  };
  artifact.workload.source = materializeSource(
    database,
    artifact.workload.source,
    "vir workload source",
  );
  delete artifact.workload.packageRef;
  return artifact;
}

function materializeExamplePackages(database, catalog) {
  const examples = new Map(
    catalog.examples.map((example) => [example.id, example]),
  );
  for (const [buildId, build] of Object.entries(database.builds ?? {})) {
    const exampleId = build?.example?.id;
    const example = examples.get(exampleId);
    if (!example) {
      throw new Error(
        `build ${buildId} references unknown example ${exampleId}`,
      );
    }
    for (const [componentId, component] of Object.entries(
      build.components ?? {},
    )) {
      if (component?.producer?.adapter !== "vir") continue;
      const workload = component?.artifact?.workload;
      if (!workload?.packageRef) continue;
      const packageSpec = example.packages.find(
        (item) => item.id === workload.packageRef,
      );
      if (!packageSpec) {
        throw new Error(
          `component ${componentId} references unknown ${exampleId} package ${workload.packageRef}`,
        );
      }
      if (workload.source?.file || workload.exports) {
        throw new Error(
          `component ${componentId} duplicates target or exports from example package ${workload.packageRef}`,
        );
      }
      workload.source.file = packageSpec.target;
      workload.exports = structuredClone(packageSpec.exports);
    }
  }
}

export async function readBuildDatabase(path) {
  const database = JSON.parse(await readFile(path, "utf8"));
  const catalog = await discoverExampleCatalog(resolve(dirname(path)));
  materializeExamplePackages(database, catalog);
  validateBuildDatabase(database);
  return database;
}

export function validateBuildDatabase(database) {
  object(database, "artifact build database");
  if (
    database.schemaVersion !== 2 ||
    database.kind !== "browser-benchmarks/artifact-build-catalog"
  ) {
    throw new Error("unsupported artifact build database");
  }
  object(database.sources, "artifact build sources");
  object(database.builds, "artifact builds");

  for (const [sourceId, value] of Object.entries(database.sources)) {
    identifier(sourceId, "source ID");
    object(value, `source ${sourceId}`);
    if (value.kind !== "git")
      throw new Error(`source ${sourceId} is not a Git source`);
    const repository = string(
      value.repository,
      `source ${sourceId} repository`,
    );
    if (!repository.startsWith("https://")) {
      throw new Error(`source ${sourceId} repository must use HTTPS`);
    }
    if (!revisionPattern.test(value.revision ?? "")) {
      throw new Error(`source ${sourceId} revision must be a full Git commit`);
    }
  }

  for (const [buildId, build] of Object.entries(database.builds)) {
    identifier(buildId, "build ID");
    object(build, `build ${buildId}`);
    const example = object(build.example, `build ${buildId} example`);
    identifier(example.id, `build ${buildId} example ID`);
    identifier(example.stageAdapter, `build ${buildId} stage adapter`);
    object(build.artifactSet, `build ${buildId} artifactSet`);
    identifier(build.artifactSet.setId, `build ${buildId} artifact set ID`);
    safeArchivePath(build.artifactSet.lock);
    if (!build.artifactSet.lock.endsWith(".json")) {
      throw new Error(`build ${buildId} has an unsafe artifact lock path`);
    }
    object(
      build.artifactSet.benchmarkContract,
      `build ${buildId} benchmark contract`,
    );
    object(build.checkouts, `build ${buildId} checkouts`);
    object(build.components, `build ${buildId} components`);

    for (const [checkoutId, sourceId] of Object.entries(build.checkouts)) {
      identifier(checkoutId, `build ${buildId} checkout ID`);
      source(
        database,
        identifier(sourceId, `build ${buildId} checkout source`),
        `checkout ${checkoutId}`,
      );
    }

    const destinations = new Set();
    for (const [componentId, component] of Object.entries(build.components)) {
      identifier(componentId, `build ${buildId} component ID`);
      object(component.artifact, `component ${componentId} artifact`);
      if (component.artifact.boundary !== artifactBoundary) {
        throw new Error(
          `component ${componentId} has an unsupported artifact boundary`,
        );
      }
      const producer = object(
        component.producer,
        `component ${componentId} producer`,
      );
      if (
        producer.protocol !== producerProtocol ||
        !adapters.has(producer.adapter)
      ) {
        throw new Error(`component ${componentId} has an unsupported producer`);
      }
      object(producer.checkouts, `component ${componentId} producer checkouts`);
      for (const [role, checkoutId] of Object.entries(producer.checkouts)) {
        identifier(role, `component ${componentId} checkout role`);
        if (!build.checkouts[checkoutId]) {
          throw new Error(
            `component ${componentId} references unknown checkout ${checkoutId}`,
          );
        }
      }
      object(producer.files, `component ${componentId} producer files`);
      if (Object.keys(producer.files).length === 0) {
        throw new Error(`component ${componentId} does not produce any files`);
      }
      for (const [packagePath, destination] of Object.entries(producer.files)) {
        safeArchivePath(packagePath);
        safeArchivePath(destination);
        if (destinations.has(destination)) {
          throw new Error(`multiple producers provide ${destination}`);
        }
        destinations.add(destination);
      }
      if (producer.adapter === "vir") {
        identifier(
          component.artifact.workload.packageRef,
          "VIR workload example package",
        );
        const runtimeSource = build.checkouts[producer.checkouts.producer];
        const workloadSource = build.checkouts[producer.checkouts.workload];
        if (
          component.artifact.runtime?.sourceRef !== runtimeSource ||
          component.artifact.workload?.source?.sourceRef !== workloadSource
        ) {
          throw new Error(
            "VIR producer checkouts and artifact provenance must use the same sources",
          );
        }
        safeArchivePath(component.artifact.workload.source.file);
        if (!Object.hasOwn(producer.files, component.artifact.workload.file)) {
          throw new Error(
            `component ${componentId} workload is not a declared package file`,
          );
        }
      } else {
        safeArchivePath(producer.entrypoint);
        safeArchivePath(producer.manifest);
        if (!Object.hasOwn(producer.files, producer.manifest)) {
          throw new Error(
            `component ${componentId} manifest is not a declared package file`,
          );
        }
      }
      for (const dependency of component.dependencies ?? []) {
        if (!build.components[dependency]) {
          throw new Error(
            `component ${componentId} depends on unknown component ${dependency}`,
          );
        }
      }
      for (const setup of producer.setup ?? []) {
        object(setup, `component ${componentId} setup command`);
        if (!producer.checkouts[setup.checkout]) {
          throw new Error(
            `component ${componentId} setup uses unknown checkout role`,
          );
        }
        string(setup.command, `component ${componentId} setup command`);
        if (
          !Array.isArray(setup.args) ||
          setup.args.some((arg) => typeof arg !== "string")
        ) {
          throw new Error(
            `component ${componentId} setup args must be strings`,
          );
        }
      }
    }

    componentOrder(build);
    artifactSetConfig(database, buildId);
  }
  return database;
}

export function selectBuild(database, buildId) {
  identifier(buildId, "build ID");
  const build = database.builds[buildId];
  if (!build) throw new Error(`unknown artifact build: ${buildId}`);
  return build;
}

export function artifactSetConfig(database, buildId) {
  const build = selectBuild(database, buildId);
  return {
    schemaVersion: 2,
    example: structuredClone(build.example),
    setId: build.artifactSet.setId,
    lock: build.artifactSet.lock,
    benchmarkContract: structuredClone(build.artifactSet.benchmarkContract),
    components: Object.fromEntries(
      Object.entries(build.components).map(([componentId, component]) => [
        componentId,
        {
          ...materializeComponent(database, component),
          adapter: component.producer.adapter,
          files: structuredClone(component.producer.files),
          producerManifest: component.producer.manifest ?? null,
        },
      ]),
    ),
  };
}

export function artifactFiles(build) {
  return Object.values(build.components)
    .flatMap((component) => Object.values(component.producer.files))
    .sort();
}

export function checkoutSources(database, buildId) {
  const build = selectBuild(database, buildId);
  return Object.fromEntries(
    Object.entries(build.checkouts).map(([checkoutId, sourceId]) => [
      checkoutId,
      { id: sourceId, ...database.sources[sourceId] },
    ]),
  );
}

export function componentOrder(build) {
  const order = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(componentId) {
    if (visiting.has(componentId))
      throw new Error("artifact component dependency cycle");
    if (visited.has(componentId)) return;
    visiting.add(componentId);
    for (const dependency of build.components[componentId].dependencies ?? [])
      visit(dependency);
    visiting.delete(componentId);
    visited.add(componentId);
    order.push(componentId);
  }
  for (const componentId of Object.keys(build.components)) visit(componentId);
  return order;
}
