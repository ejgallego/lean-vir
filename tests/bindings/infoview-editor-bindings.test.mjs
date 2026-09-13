/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import test from "node:test";
import { createInfoviewPanelBindings } from "../../web/src/host/vir-infoview-panel-bindings.js";
import { typeScriptDiagnostics } from "../support/typescript-probe.mjs";

test("editor declarations match pinned upstream receivers and results", () => {
  const diagnostics = typeScriptDiagnostics(`
    import { EditorContext } from '../../node_modules/@leanprover/infoview/dist/infoview/contexts';
    import { EditorConnection } from '../../node_modules/@leanprover/infoview/dist/infoview/editorConnection';
    import { DocumentPosition } from '../../node_modules/@leanprover/infoview/dist/infoview/util';
    import { EditorApi, TextInsertKind } from '@leanprover/infoview-api';
    import type { EditorApi as SelectedEditorApi, EditorConnection as SelectedConnection }
      from '../../Vir/Infoview/Editor.contract';
    import { TextDocumentPositionParams } from 'vscode-languageserver-protocol';
    declare global { namespace JSX { type Element = import('react').ReactElement; } }
    const context: import('react').Context<EditorConnection> = EditorContext;
    export function operations(c: EditorConnection, p: DocumentPosition, text: string,
        kind: TextInsertKind, pos: TextDocumentPositionParams | undefined): Promise<void>[] {
      const api: EditorApi = c.api;
      const selected: SelectedEditorApi = api;
      const native: Pick<EditorApi, 'copyToClipboard' | 'insertText'> = selected;
      const selectedConnection: SelectedConnection = c;
      const tdpp: TextDocumentPositionParams = DocumentPosition.toTdpp(p);
      return [c.revealPosition(p), api.copyToClipboard(text),
        api.insertText(text, kind, pos), api.insertText(text, 'here', tdpp)];
    }
  `);
  assert.deepEqual(diagnostics.map(d => String(d.messageText)), []);
});

test("editor calls preserve receiver, arguments, Promise identity and rejection", async () => {
  const calls = [];
  const failure = { reason: "denied" };
  const promise = Promise.reject(failure);
  const observed = assert.rejects(promise, error => error === failure);
  const api = {
    copyToClipboard(text) { calls.push([this, text]); return promise; },
    insertText(...args) { calls.push([this, ...args]); return promise; },
  };
  const connection = {
    api,
    revealPosition(position) { calls.push([this, position]); return promise; },
  };
  const context = { current: connection };
  const pos = { uri: "file:///Example.lean", line: 1, character: 2 };
  const tdpp = { textDocument: { uri: pos.uri }, position: pos };
  const b = createInfoviewPanelBindings({
    editorContext: context,
    positionToTdpp: p => { assert.equal(p, pos); return tdpp; },
  });
  assert.equal(b["infoview.editorContext"](), context);
  assert.equal(b["infoview.editorConnection.api"](connection), api);
  assert.equal(b["infoview.panelPosition.toTdpp"](pos), tdpp);
  assert.equal(b["infoview.editorConnection.revealPosition"](connection, pos), promise);
  assert.equal(b["infoview.editorApi.copyToClipboard"](api, ""), promise);
  assert.equal(b["infoview.editorApi.insertText"](api, "x", b["infoview.textInsertKind.here"](), tdpp), promise);
  assert.equal(b["infoview.editorApi.insertText"](api, "y", b["infoview.textInsertKind.above"](), undefined), promise);
  assert.deepEqual(calls, [[connection, pos], [api, ""], [api, "x", "here", tdpp], [api, "y", "above", undefined]]);
  await observed;
  const thrown = new Error("synchronous host failure");
  assert.throws(() => b["infoview.editorApi.copyToClipboard"]({ copyToClipboard() { throw thrown; } }, "x"), e => e === thrown);
  assert.throws(() => createInfoviewPanelBindings()["infoview.editorContext"](), /upstream/);
});
