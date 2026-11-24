import { useContext } from "react";
import { z } from "zod";
import { createComponentImplementation } from "@a2ui/react";
import { DynamicNumberSchema, DynamicStringSchema } from "@a2ui/web_core/v1_0";
import { duringClick } from "../../clickOnly.ts";
import { LinksContext } from "../../links.ts";
import { FileLabel, PointedLink } from "./PointedLink.tsx";

/** Quay's own component: a link to a file. */
const FileLinkApi = {
  name: "FileLink",
  schema: z
    .object({
      path: DynamicStringSchema.describe("REF:#/$defs/DynamicString|The file, absolute or relative to the terminal's working directory."),
      line: DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber|A line of the file.").optional(),
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
  const address = line === undefined ? path : `${path}:${line}`;
  if (!links || path === "") return label ?? address;
  return (
    <PointedLink links={links} address={address} onClick={() => duringClick("showFile", () => links.effects.showFile(path, line))}>
      <FileLabel>{label ?? address}</FileLabel>
    </PointedLink>
  );
};

/** A line number, or nothing for any other number. */
const lineOf = (line: unknown) => (Number.isInteger(line) && Number(line) > 0 && Number(line) <= 0xffffffff ? Number(line) : undefined);

/** A link that shows a file at the operator's click. The path is judged then. */
export const FileLink = createComponentImplementation(FileLinkApi, ({ props }) => (
  <FileLinkView path={typeof props.path === "string" ? props.path : ""} line={lineOf(props.line)} label={props.label} />
));
