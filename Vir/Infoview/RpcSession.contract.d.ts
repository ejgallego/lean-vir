/**
 * Selected declaration from @leanprover/infoview-api.
 *
 * Provenance: leanprover/vscode-lean4
 * commit 5a25e6abb2e973b4c89a053acc74c479c0bb2e9f
 * lean4-infoview-api/src/rpcSessions.ts
 *
 * The optional ClientRequestOptions parameter is deliberately omitted from
 * this first exact call shape and remains a tracked compatibility gap.
 */
export interface RpcSessionAtPos {
  call<T, S>(method: string, params: T): Promise<S>;
}
