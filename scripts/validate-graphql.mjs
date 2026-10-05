// Validates every `#graphql` document in app/ against the pinned Admin API schema.
// Run `npm run graphql-codegen` first to download the schema (app/types/*.schema.json).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildClientSchema, parse, validate } from "graphql";

const schemaFile = readdirSync("app/types").find((f) => f.endsWith(".schema.json"));
if (!schemaFile) {
  console.error("No schema found in app/types — run `npm run graphql-codegen` first.");
  process.exit(1);
}
const introspection = JSON.parse(readFileSync(join("app/types", schemaFile), "utf8"));
const schema = buildClientSchema(introspection.data ?? introspection);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) yield path;
  }
}

let documents = 0;
let failures = 0;
for (const file of walk("app")) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/`#graphql([\s\S]*?)`/g)) {
    documents++;
    const line = source.slice(0, match.index).split("\n").length;
    try {
      const errors = validate(schema, parse(match[1]));
      for (const error of errors) {
        failures++;
        console.error(`${relative(".", file)}:${line} ${error.message}`);
      }
    } catch (error) {
      failures++;
      console.error(`${relative(".", file)}:${line} ${error.message}`);
    }
  }
}

console.log(`${documents} GraphQL documents checked against ${schemaFile}, ${failures} error(s).`);
process.exit(failures ? 1 : 0);
