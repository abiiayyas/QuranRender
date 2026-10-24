import type { AssetRef } from "../bindings";
import type { Project } from "./model";

/** Gelap-redup bawaan di atas latar media (sama dengan nilai yang ditulis `background_import`). */
export const DIMMER_DEFAULT = 0.35;
export const DIMMER_KEY = "background_dimmer";

/** Klip pertama jalur Latar yang punya aset, beserta aset terdaftarnya (`null` bila belum ada). */
export function backgroundOf(project: Project): { assetId: string; asset: AssetRef | null } | null {
  const track = project.tracks.find((t) => t.kind === "Background");
  const clip = track?.clips.find((c) => c.asset_id);
  if (!clip?.asset_id) return null;
  return { assetId: clip.asset_id, asset: project.assets[clip.asset_id] ?? null };
}

/** Dimmer efektif di atas latar media (0..1). Disimpan sebagai string di `style_overrides`. */
export function dimmerOf(project: Project): number {
  const raw = Number(project.style_overrides[DIMMER_KEY]);
  return project.style_overrides[DIMMER_KEY] !== undefined && Number.isFinite(raw)
    ? Math.min(Math.max(raw, 0), 1)
    : DIMMER_DEFAULT;
}
