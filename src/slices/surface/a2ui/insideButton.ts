import { createContext } from "react";

/** Whether what is drawn is inside a button, where no link and no block of text can be. */
export const InsideButton = createContext(false);

/** Whether what is drawn is all there is of a button, which then goes by its name. */
export const AloneInButton = createContext(false);
