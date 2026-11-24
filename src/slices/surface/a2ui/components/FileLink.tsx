import { useContext } from "react";
import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { DynamicStringSchema } from "@a2ui/web_core/v1_0";
import { duringClick } from "../../clickOnly.ts";
import { LinksContext } from "../../links.ts";
import { InsideButton } from "../insideButton.ts";
import { FILE_FIELDS, namedFile } from "../namedFile.ts";
import { FileLabel, PointedLink } from "./PointedLink.tsx";

/** Quay's own component: a link to a file. */
const FileLinkApi = {
  name: "FileLink",
  schema: z
    .object({
      ...FILE_FIELDS,
      label: DynamicStringSchema.describe("REF:#/$defs/DynamicString|What the link reads. The path when left out.").optional(),
    })
    .strict(),
};

interface FileLinkViewProps {
  path: string;
  line: number | undefined;
  label: string | undefined;
}

const FileLinkView = ({ path, line, label }: FileLinkViewProps) => {
  const links = useContext(LinksContext);
  const insideButton = useContext(InsideButton);
  const address = line === undefined ? path : `${path}:${line}`;
  if (!links || insideButton || path === "") return label ?? address;
  return (
    <PointedLink links={links} address={address} onClick={() => duringClick("showFile", () => links.effects.showFile(path, line))}>
      <FileLabel>{label ?? address}</FileLabel>
    </PointedLink>
  );
};

/** A link that shows a file at the operator's click. The path is judged then. */
export const FileLink = createComponentImplementation(FileLinkApi, ({ props }) => (
  <FileLinkView {...namedFile(props)} label={props.label} />
));
