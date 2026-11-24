// The classes of the cards' own buttons. Cards only: the plain parts have no danger variant.
import { BUTTON_SHAPE } from "../parts/buttonStyles.ts";

/** A card's red button, for a refusal or a choice that can't be undone. */
export const DANGER = `${BUTTON_SHAPE} border-[#da3633] bg-[#da3633] text-white enabled:hover:bg-[#f85149]`;
