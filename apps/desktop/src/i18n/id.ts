import { appId } from "./messages/app.id";
import { commonId } from "./messages/common.id";
import { studioId } from "./messages/studio.id";

/** Katalog Indonesia (bawaan). Tiap area punya berkas sendiri di `messages/`; kunci tidak boleh bentrok. */
export const id = { ...commonId, ...appId, ...studioId } as const;
