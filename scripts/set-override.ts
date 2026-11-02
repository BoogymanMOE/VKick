import { getDb } from "../server/db/index.ts";

const args = process.argv.slice(2);
// usage: tsx scripts/set-override.ts --entity=player --id=123 --field=photo --value=/faces/123.webp
const get = (key: string) => {
  const a = args.find((x) => x.startsWith(`--${key}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
const entityType = get("entity");
const entityId = get("id");
const field = get("field");
const value = get("value");
if (!entityType || !entityId || !field || value === null) {
  console.error("Usage: tsx scripts/set-override.ts --entity=player --id=123 --field=photo --value=/faces/123.webp");
  process.exit(1);
}
const db = getDb();
db.prepare("INSERT INTO manual_overrides (entity_type, entity_id, field, value, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity_type, entity_id, field) DO UPDATE SET value=excluded.value, created_at=excluded.created_at")
  .run(entityType, entityId, field, value, new Date().toISOString());
console.log("override set:", entityType, entityId, field, "=", value);
