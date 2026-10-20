// Packs each tutorial's starter/ and check/ folders under examples/ into the
// zips the tutorial pages link to, in docs/public/starters/. `docs:build` runs
// this before VitePress, so a local preview has exactly the live site's zips.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const examplesDir = "examples";
const outDir = join("docs", "public", "starters");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(message) {
  console.error(`pack-starters: ${message}`);
  process.exit(1);
}

function gitLsFiles(args) {
  const out = execFileSync("git", ["ls-files", "--exclude-standard", "-z", ...args], {
    cwd: examplesDir,
    encoding: "utf8",
  });
  return out.split("\0").filter(Boolean);
}

// Every file under examples/ that is tracked or untracked but never matched by
// a .gitignore, including tracked files that were force-added past one. Paths
// use forward slashes and are relative to examples/.
function listFiles() {
  const ignored = new Set(gitLsFiles(["--cached", "--ignored"]));
  const files = new Set(gitLsFiles(["--cached", "--others"]));
  return [...files].filter((file) => !ignored.has(file) && existsSync(join(examplesDir, file)));
}

// Groups files by the starter/ or check/ folder they sit in. The folder holding
// them names the tutorial, so examples/<slug>/starter/ and
// examples/tutorials/<slug>/starter/ both pack as <slug>.zip. A starter unzips
// into an empty folder, so its files sit at the zip root; a check suite unzips
// into the project, so its files keep their check/ folder.
function collectZips(files) {
  const zips = new Map();
  for (const file of files) {
    const parts = file.split("/");
    const at = parts.findIndex((part) => part === "starter" || part === "check");
    if (at < 1) continue;
    const slug = parts[at - 1];
    if (!slugPattern.test(slug)) {
      fail(
        `${["examples", ...parts.slice(0, at)].join("/")}: slug "${slug}" must be ` +
          "lowercase letters and digits, with single hyphens between them",
      );
    }
    const isCheck = parts[at] === "check";
    const name = isCheck ? `${slug}-check.zip` : `${slug}.zip`;
    const folder = ["examples", ...parts.slice(0, at + 1)].join("/");
    const entry = parts.slice(isCheck ? at : at + 1).join("/");
    if (!zips.has(name)) zips.set(name, { folder, files: [] });
    const zip = zips.get(name);
    if (zip.folder !== folder) {
      fail(`${zip.folder} and ${folder} would both be packed as ${name}`);
    }
    zip.files.push({ source: join(examplesDir, file), entry });
  }
  return zips;
}

// The fields a local file header and its central directory record share, from
// "version needed to extract" through the name length. The local header holds
// them from byte 4, the central record from byte 6.
function writeSharedHeader(header, at, { stored, crc, body, data, name }) {
  header.writeUInt16LE(20, at); // version needed to extract
  header.writeUInt16LE(0x0800, at + 2); // names are UTF-8
  header.writeUInt16LE(stored ? 0 : 8, at + 4); // stored or deflated
  header.writeUInt16LE(0, at + 6); // 00:00:00
  header.writeUInt16LE(0x21, at + 8); // 1980-01-01
  header.writeUInt32LE(crc, at + 10);
  header.writeUInt32LE(body.length, at + 14);
  header.writeUInt32LE(data.length, at + 18);
  header.writeUInt16LE(name.length, at + 22);
}

// A minimal zip writer: deflated entries, UTF-8 names, and a fixed timestamp
// so the same files always produce the same bytes.
function writeZip(path, entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { source, entry } of entries) {
    const data = readFileSync(source);
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const name = Buffer.from(entry, "utf8");
    const fields = { stored, crc: crc32(data), body, data, name };

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    writeSharedHeader(local, 4, fields);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    writeSharedHeader(central, 6, fields);
    central.writeUInt32LE(offset, 42); // where the local header starts

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(path, Buffer.concat([...locals, directory, end]));
}

const zips = existsSync(examplesDir) ? collectZips(listFiles()) : new Map();

// The folder holds only what this script writes, so clearing it drops zips for
// starters that were renamed or removed since the last build.
rmSync(outDir, { recursive: true, force: true });
if (zips.size > 0) mkdirSync(outDir, { recursive: true });
for (const [name, { files }] of zips) {
  const entries = files.sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  writeZip(join(outDir, name), entries);
}
