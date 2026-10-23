export type CommandResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

/** Benar bila halaman berjalan di dalam webview Tauri (bukan vite biasa di peramban). */
export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

/** Membuka hasil perintah; galat dilempar sebagai Error agar pemanggil menampilkannya di UI. */
export async function unwrap<T>(result: Promise<CommandResult<T>>): Promise<T> {
  const r = await result;
  if (r.status === "error") throw new Error(r.error);
  return r.data;
}
