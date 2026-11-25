import { createContext } from "react";

/** Gives the text that is drawn with nothing in it that the operator typed. Nothing is known of it where none is given. */
export const UntypedText = createContext<() => string>(() => "");
