// Thin client for Flint. Civic never imports a vendor SDK.
export interface FlintCompletionRequest {
  task: "civic.extract_positions" | "civic.tag_votes";
  models?: string[];          // Flint decides if omitted
  system: string;
  input: string;
  jsonSchema: Record<string, unknown>;
}

export async function flintComplete<T>(req: FlintCompletionRequest): Promise<{ model: string; output: T; costCents: number }> {
  const res = await fetch(`${process.env.FLINT_BASE_URL}/v1/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.FLINT_API_KEY ?? ""}` },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`flint ${res.status}: ${await res.text()}`);
  return (await res.json()) as { model: string; output: T; costCents: number };
}
