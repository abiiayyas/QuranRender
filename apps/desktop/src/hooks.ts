import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
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

/** Posisi kursor seret dalam piksel fisik jendela (bagi dengan `devicePixelRatio` untuk piksel CSS). */
export type DragPosition = { x: number; y: number };

/** Keadaan seretan berkas yang sedang melayang di atas jendela. */
export type FileDrag = { paths: string[]; position: DragPosition | null };

/** Mengubah posisi fisik seretan menjadi titik di koordinat CSS viewport. */
export function cssPoint(position: DragPosition | null): DragPosition | null {
  if (!position) return null;
  const r = window.devicePixelRatio || 1;
  return { x: position.x / r, y: position.y / r };
}

/**
 * Menerima berkas yang diseret dari Finder/File Explorer ke jendela selama komponen terpasang.
 * Webview tidak memberi path lewat event HTML5 `drop`, jadi dipakai event drag-drop Tauri
 * (`dragDropEnabled` bawaan aktif). Mengembalikan seretan yang sedang berlangsung (path dan posisi
 * kursor, diperbarui tiap `over`), atau `null` bila tidak ada. `onDrop` menerima path dan posisi
 * lepas; selalu versi terbaru.
 */
export function useFileDrop(
  onDrop: (paths: string[], position: DragPosition | null) => void,
  onError: (message: string) => void
): FileDrag | null {
  const [dragging, setDragging] = useState<FileDrag | null>(null);
  const dropRef = useRef(onDrop);
  const errorRef = useRef(onError);
  dropRef.current = onDrop;
  errorRef.current = onError;

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") {
          setDragging({ paths: payload.paths, position: payload.position });
        } else if (payload.type === "over") {
          setDragging((d) => (d ? { ...d, position: payload.position } : d));
        } else if (payload.type === "drop") {
          setDragging(null);
          if (payload.paths.length > 0) dropRef.current(payload.paths, payload.position);
        } else if (payload.type === "leave") {
          setDragging(null);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => errorRef.current(errorText(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return dragging;
}
