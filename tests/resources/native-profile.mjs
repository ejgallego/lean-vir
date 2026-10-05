// Resource programs have a locked runtime profile, not ambient native providers.
import assert from "node:assert/strict";
import { replaceFixture } from "./fixture-edit.mjs";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function checkNativeProfileRejection({
  client,
  producer,
  env,
  evidence,
}) {
  const dir = join(evidence, "native-profile");
  mkdirSync(dir);
  const cold = join(dir, "cold");
  mkdirSync(cold);
  for (const name of [
    "program",
    "resources",
    "vir-resources",
    "lean-toolchain",
  ])
    cpSync(join(client, name), join(cold, name), { recursive: true });
  const config = readFileSync(join(client, "lakefile.lean"), "utf8");
  const requirements = config.match(/require lean_vir from "[^"]+"/g) ?? [];
  assert.equal(requirements.length, 1, "native-profile fixture requires one VIR dependency");
  writeFileSync(
    join(cold, "lakefile.lean"),
    replaceFixture(config, requirements[0],
      `require lean_vir from ${JSON.stringify(producer)}`,
    ),
  );
  const manifest = join(dir, "native.json");
  writeFileSync(
    join(dir, "provider.c"),
    "/* Parser fixture; never linked or executed. */\n",
  );
  writeFileSync(
    manifest,
    JSON.stringify({
      format: "lean-vir-client-native-externs",
      version: 1,
      modules: ["Client.Program"],
      externs: ["Client.Profile.externalValue"],
      providerSources: ["provider.c"],
    }),
  );
  const stage = join(client, ".vir-generated/ClientResources.virres");
  const output = join(
    client,
    "build with spaces/vir/resources/programs/ClientResources.virres",
  );
  const retained = [
    stage,
    output,
    join(client, "build with spaces/vir/programs/Client/Program.virprogram"),
    `${output}.trace`,
    `${output}.hash`,
  ].filter(existsSync);
  const snapshot = (path) => {
    const stat = statSync(path, { bigint: true });
    return [stat.ino, stat.mtimeNs, readFileSync(path)];
  };
  const before = retained.map(snapshot);
  const tool = join(producer, ".lake/build/bin/vir_resource_program");
  const recipe = join(client, "vir-resources/ClientResources.json");
  const compatibility = join(producer, "vir-resources/compatibility.json");
  for (const [label, value] of [
    ["empty", ""],
    ["missing", join(dir, "missing.json")],
    ["valid", manifest],
  ]) {
    const cases = [
      ["warm", client, "lake", ["build", "ClientResources:virResourcePack"]],
      ["cold", cold, "lake", ["build", "ClientResources:virResourcePack"]],
      ["plan", client, tool, ["plan", recipe, compatibility, client]],
      [
        "build",
        client,
        tool,
        [
          "build",
          recipe,
          compatibility,
          join(
            client,
            "build with spaces/vir/programs/Client/Program.virprogram",
          ),
          client,
          join(dir, "unexpected.virres"),
        ],
      ],
    ];
    for (const [mode, cwd, cmd, args] of cases) {
      const result = spawnSync(cmd, args, {
        cwd,
        env: { ...env, VIR_NATIVE_EXTERN_MANIFEST: value },
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      writeFileSync(join(dir, `${label}-${mode}.log`), log);
      assert.ifError(result.error);
      assert.notEqual(
        result.status,
        0,
        `${label}-${mode}: accepted ambient profile`,
      );
      assert.match(
        log,
        /VIR_RESOURCE_NATIVE_PROFILE_UNSUPPORTED/,
        `${label}-${mode}: ${log}`,
      );
      assert.deepEqual(
        retained.map(snapshot),
        before,
        "rejection mutated existing outputs",
      );
      assert.equal(
        existsSync(join(cold, ".vir-generated/ClientResources.virres")),
        false,
      );
      assert.equal(existsSync(join(dir, "unexpected.virres")), false);
    }
  }
}
