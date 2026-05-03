const P = "oai:";

export function getCached<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(P + key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(P + key, JSON.stringify(data));
  } catch { /* storage full — ignore */ }
}
