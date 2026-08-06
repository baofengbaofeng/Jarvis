export interface InjectionApprovalDto {
  kind: string;
  name: string;
  digest: string;
  taskId: string;
  createdAt: string;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Typed client for daemon SEC-09 injection approval endpoints. DTOs only — no secrets/raw args. */
export class InjectionApprovalClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async list(): Promise<InjectionApprovalDto[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/runtime/injection-approvals`, {
      method: 'GET',
      headers: { ...authHeaders(this.token) },
    });
    if (!res.ok) {
      throw Object.assign(new Error(`injection approvals list failed: ${res.status}`), { status: res.status });
    }
    const body = (await res.json()) as InjectionApprovalDto[];
    return (body ?? []).map((item) => ({
      kind: item.kind,
      name: item.name,
      digest: item.digest,
      taskId: item.taskId,
      createdAt: item.createdAt,
    }));
  }

  async approve(input: { kind: string; name: string; digest: string }): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/runtime/injection-approvals/${encodeURIComponent(input.digest)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(this.token) },
        body: JSON.stringify({ kind: input.kind, name: input.name }),
      },
    );
    if (!res.ok) {
      throw Object.assign(new Error(`injection approval failed: ${res.status}`), { status: res.status });
    }
  }
}
