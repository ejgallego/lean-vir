# Five-minute native infoview tour

Use this worktree's VS Code window (`native-infoview-port`), with the Lean 4
extension enabled. No browser development server is needed for these widgets.
If VS Code asks about workspace trust, review and approve it yourself to enable
the extension. Open **Lean 4: InfoView: Toggle InfoView** from the command palette
if the Infoview is hidden.

## 1. Compare the two renderers

Open [Comparison.lean](../../examples/VirNativeInfoview/Comparison.lean) and
place the cursor in the proof at the bottom. Move between `constructor` and
the two `exact` lines; both panels should follow the current goals.

- **Lean port:** the goal panel and interactive expression renderer are Lean code.
- **Upstream component checkpoint:** the same Lean goal panel embeds the existing
  TypeScript `InteractiveCode` component from `@leanprover/infoview`.

Widen the Infoview for side-by-side cards; a narrow pane stacks them. Hover over
`p` or `q` in an expression to request type information. In the Lean panel, click
an interactive expression to pin its popup, then close it. Expand the panel's
settings, change presentation options, collapse a goal, and try copying it.
The two panels have independent settings.

In the Lean panel, pause over a term for half a second: the deepest subexpression
highlights and its type popup floats without moving the goal text. Move into the
popup to inspect it; leaving gives a short grace period before dismissal. Click
to pin, or use Escape/the close button to dismiss it.

## 2. Try the standalone Lean panel

Open [VirNativeInfoview.lean](../../examples/VirNativeInfoview.lean) and move
through its final proof. This uses the Lean renderer without the comparison
component. Its implementation lives in
[GoalPanel.lean](../../examples/VirNativeInfoview/GoalPanel.lean) and
[InteractiveCode.lean](../../examples/VirNativeInfoview/InteractiveCode.lean).
The small external-component boundary is in
[Composition.lean](../../examples/VirNativeInfoview/Composition.lean).

## 3. Play with Tamagotchi

Open [ReactTamagotchiWidget.lean](../../examples/ReactTamagotchiWidget.lean),
then place the cursor in its final theorem. Try feeding, playing, napping,
waking, changing the artwork, and resetting. This is a separate Lean-authored
React widget, useful for exploring state and event handlers.

For the smallest authoring example, open
[ReactProofWidgetHello.lean](../../examples/tutorials/ReactProofWidgetHello.lean):
its widget shows the current source URI and first goal.

## What is intentionally unfinished?

This ports the goal panel and interactive code, not the surrounding infoview
shell. Native expression selection and modifier-click definition navigation
are not implemented yet; native popups now float, but documentation is plain
text. The upstream checkpoint retains upstream behavior. See the
[port assessment](../development/NATIVE_INFOVIEW_PORT.md) for exact coverage and
the known upstream development-StrictMode popup limitation.

## If something looks stuck

Allow the initial Lean elaboration and widget package generation to finish.
Keep the cursor inside a proof, and check the Problems panel for actual errors.
If needed, run **Lean 4: Server: Restart Server**, especially after upgrading
the imported VIR library. The construction refinement fixes the earlier
JSX-local unused-variable warnings.

To refresh the built workspace and browser demo packages from its terminal:

```sh
lake build Vir VirInfoview VirExamples +VirNativeInfoview.Comparison
npm run build:demo-package
npm run check:infoview-bundle
```

The existing compatible `web/public/vir-upstream.wasm` is reused; these commands
do not rebuild the Wasm runtime. After editing an imported Lean module, rebuild
it and restart the Lean server so dependent files see the new version.
