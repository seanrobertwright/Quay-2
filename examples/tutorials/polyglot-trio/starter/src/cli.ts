// Usage: node src/cli.ts <file.csv>
// Prints the CSV file as a JSON array of objects, as SPEC.md describes.

const USAGE = "Usage: node src/cli.ts <file.csv>";
const [file] = process.argv.slice(2);

if (file === undefined) {
  console.error(USAGE);
  process.exit(2);
}

console.error("not implemented");
process.exit(2);
