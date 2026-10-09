/** Selected native editor members from @leanprover/infoview(-api).
 * Pinned source: leanprover/vscode-lean4 5a25e6abb2e973b4c89a053acc74c479c0bb2e9f.
 * The independent TypeScript probe checks these against the installed declarations.
 */
export interface DocumentPosition {
  uri: string;
  line: number;
  character: number;
}
/** Selected static member of the native DocumentPosition namespace. */
export interface DocumentPositionOperations {
  toTdpp(position: DocumentPosition): TextDocumentPositionParams;
}
export interface TextDocumentPositionParams {
  textDocument: { uri: string };
  position: { line: number; character: number };
}
export type TextInsertKind = 'here' | 'above';
export interface EditorApi {
  copyToClipboard(text: string): Promise<void>;
  insertText(text: string, kind: TextInsertKind, pos?: TextDocumentPositionParams): Promise<void>;
}
export interface EditorConnection {
  readonly api: EditorApi;
  revealPosition(pos: DocumentPosition): Promise<void>;
}
