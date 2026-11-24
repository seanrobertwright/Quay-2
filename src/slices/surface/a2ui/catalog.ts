// Quay's catalog: derived from the standard's basic catalog, drawn by Quay's own components.
import type { ReactCatalogComponent } from "@a2ui/react";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import type { Catalog } from "@a2ui/web_core/v1_0";
import { Button } from "./components/Button.tsx";
import { Card } from "./components/Card.tsx";
import { CheckBox } from "./components/CheckBox.tsx";
import { ChoicePicker } from "./components/ChoicePicker.tsx";
import { Column } from "./components/Column.tsx";
import { Divider } from "./components/Divider.tsx";
import { FileLink } from "./components/FileLink.tsx";
import { Image } from "./components/Image.tsx";
import { List } from "./components/List.tsx";
import { Progress } from "./components/Progress.tsx";
import { Row } from "./components/Row.tsx";
import { Stat } from "./components/Stat.tsx";
import { Steps } from "./components/Steps.tsx";
import { Tabs } from "./components/Tabs.tsx";
import { Text } from "./components/Text.tsx";
import { TextField } from "./components/TextField.tsx";
import { EFFECTS } from "./effects.ts";
import { weighted } from "./weighted.tsx";

export const CATALOG_ID = "urn:quay:a2ui:catalog:v1";

/** The basic catalog's components that Quay keeps, with every property the standard gives them. */
const KEPT = [Text, Image, Row, Column, List, Card, Tabs, Divider, Button, TextField, CheckBox, ChoicePicker];

const OWN = [Progress, Steps, Stat, FileLink];

const COMPONENTS: ReactCatalogComponent[] = [...KEPT.map(weighted), ...OWN];

/** Its functions are Quay's own effects so far: the basic `openUrl` would open a window. */
export const catalog = basicCatalog.derive({ catalogId: CATALOG_ID, components: COMPONENTS, functions: EFFECTS }) as Catalog<ReactCatalogComponent>;
