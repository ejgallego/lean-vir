export interface BenchmarkBackend {
  id: string;
  label: string;
  status: string;
}

export interface BenchmarkReadiness {
  readyCount: number;
  backendCount: number;
}

export interface BenchmarkController {
  ready: Promise<BenchmarkReadiness>;
  getBackends(): BenchmarkBackend[];
  runStudy(studyId: string): Promise<unknown>;
  dispose?(): void;
}

export interface ExampleContext {
  example: Record<string, unknown> & { id: string };
  artifactBaseUrl: URL;
}

export declare function requireController(
  value: unknown,
  exampleId: string,
): BenchmarkController;
