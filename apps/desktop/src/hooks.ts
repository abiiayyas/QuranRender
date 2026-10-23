import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { errorText, isTauri } from "./tauri";

/**
 * Berlangganan event Tauri selama komponen terpasang. `handler` selalu versi terbaru (tanpa
 * berlangganan ulang). Galat pendaftaran dilaporkan lewat `onError` agar tampil di UI.
 */
export function useTauriEvent<T>(
  name: string,
  handler: (payload: T) => void,
  onError: (message: string) => void
): void {
  const handlerRef = useRef(handler);
  const errorRef = useRef(onError);
  handlerRef.current = handler;
  errorRef.current = onError;

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen<T>(name, (event) => handlerRef.current(event.payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => errorRef.current(errorText(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}
