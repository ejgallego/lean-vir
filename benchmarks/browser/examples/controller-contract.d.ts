export interface BenchmarkBackend {
  id: string;
  label: string;
  status: string;
}

export interface BenchmarkReadiness {
  readyCount: number;
  backendCount: number;
}

export interface BenchmarkReport {
  kind: string;
  passed: boolean;
  backendIds: string[];
  [field: string]: unknown;
}

export interface BenchmarkController {
  ready: Promise<BenchmarkReadiness>;
  getBackends(): BenchmarkBackend[];
  runStudy(
    studyId: string,
    options?: Record<string, unknown>,
  ): Promise<BenchmarkReport>;
  dispose?(): void;
}

export interface ExampleContext {
  example: Record<string, unknown> & { id: string };
  artifactBaseUrl: URL;
  testPackage: Record<string, unknown>;
  testPackageIdentity: { file: string; bytes: number; sha256: string };
  variant: Record<string, unknown> & { id: string };
}

export declare function requireController(
  value: unknown,
  exampleId: string,
): BenchmarkController;
