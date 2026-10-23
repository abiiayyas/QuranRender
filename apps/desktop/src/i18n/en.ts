import type { id } from "./id";
import { appEn } from "./messages/app.en";
import { commonEn } from "./messages/common.en";
import { studioEn } from "./messages/studio.en";

/** Katalog Inggris. Tipe `Record<MessageKey, string>` memaksa himpunan kunci identik dengan `id`. */
export const en: Record<keyof typeof id, string> = { ...commonEn, ...appEn, ...studioEn };
