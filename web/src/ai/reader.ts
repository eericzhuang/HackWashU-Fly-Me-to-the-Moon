import type { ReadResult } from "../../shared/types";
import { classify, type Outcome } from "./classify";

/** Asks the server to OCR a scan's reveal.png. Never rejects: any failure becomes kind "error". */
export class HttpReader {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) {
    this.fetchImpl = fetchImpl;
  }

  async read(scan: string): Promise<Outcome> {
    try {
      const res = await this.fetchImpl("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scan }),
      });
      if (!res.ok) {
        console.warn("OCR failed:", res.status, await res.text());
        return classify(null);
      }
      return classify((await res.json()) as ReadResult);
    } catch (e) {
      console.warn("OCR failed:", e);
      return classify(null);
    }
  }
}
