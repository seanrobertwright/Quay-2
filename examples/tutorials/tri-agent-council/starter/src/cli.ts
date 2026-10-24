const USAGE = "Usage: node src/cli.ts <folder>";

const folder = process.argv[2];
if (folder === undefined) {
  console.error(USAGE);
  process.exit(2);
}

console.error("not implemented");
process.exit(2);
