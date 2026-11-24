// Quay's catalog: derived from the standard's basic catalog, drawn by Quay's own components.
import type { ReactCatalogComponent } from "@a2ui/react";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import type { Catalog } from "@a2ui/web_core/v1_0";
import { Button } from "./components/Button.tsx";
import { ChoicePicker } from "./components/ChoicePicker.tsx";
import { Column } from "./components/Column.tsx";
import { FileLink } from "./components/FileLink.tsx";
import { Text } from "./components/Text.tsx";
import { TextField } from "./components/TextField.tsx";
import { EFFECTS } from "./effects.ts";

export const CATALOG_ID = "urn:quay:a2ui:catalog:v1";

const COMPONENTS: ReactCatalogComponent[] = [Text, Column, Button, TextField, ChoicePicker, FileLink];

/** Its functions are Quay's own effects so far: the basic `openUrl` would open a window. */
export const catalog = basicCatalog.derive({ catalogId: CATALOG_ID, components: COMPONENTS, functions: EFFECTS }) as Catalog<ReactCatalogComponent>;
