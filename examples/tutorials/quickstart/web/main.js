const result = document.getElementById("result");
let program;
try {
  const configUrl = new URL("./app.json", import.meta.url);
  const response = await fetch(configUrl);
  if (!response.ok) throw new Error(`Cannot load application assets: HTTP ${response.status}`);
  const config = await response.json();
  const { createProgram } = await import(new URL(config.runtimeModule, configUrl).href);
  program = await createProgram({
    runtimeManifestUrl: new URL(config.runtimeManifest, configUrl),
    programManifestUrl: new URL(config.programManifest, configUrl),
  });
  result.textContent = program.call("QuickstartApp.Program.greet", "world");
} catch (error) {
  console.error("Lean initialization or call failed", error);
  result.textContent = `Lean failed: ${error instanceof Error ? error.message : String(error)}`;
} finally {
  // This finite demonstration does not retain an interactive program instance.
  try { program?.dispose(); }
  catch (error) { console.error("Lean cleanup failed", error); }
}
