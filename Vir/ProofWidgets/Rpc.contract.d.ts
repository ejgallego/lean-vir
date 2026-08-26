/** Host-side reference descriptor used by the ProofWidgets bridge. */
export interface RpcRef {
  id: string;
  label: string;
  typeName: string;
  summary: string;
  expression: string;
  typeText?: string;
  context?: string;
  serverRef?: ServerRef;
}

/** Optional server-owned reference attached to a completed RPC reference. */
export interface ServerRef {}

/** Value returned by asynchronous ProofWidgets reference resolution. */
export interface ResolvedRef {
  id: string;
  label: string;
  typeName: string;
  summary: string;
  expression: string;
  typeText: string;
  context: string;
  source: string;
  position: string;
  packageRevision: string;
  storeKey: string;
  knownConstant: boolean;
}

/** Local ProofWidgets reference transport supplied by the VIR host. */
export interface ProofWidgetsRpcHost {
  ref(
    id: string,
    label: string,
    typeName: string,
    summary: string,
    expression: string,
  ): RpcRef;
  finishRef(ref: RpcRef, typeText: string, context: string, serverRef: ServerRef | null): RpcRef;
  resolvedRefValue(ref: ResolvedRef): ResolvedRef;
  inspectRef(ref: RpcRef): boolean;
  resolveRef(ref: RpcRef, callback: (resolved: ResolvedRef) => void): boolean;
}
