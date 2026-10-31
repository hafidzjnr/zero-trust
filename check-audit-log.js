
const db = require("./shared/database");

const logs = db.prepare(`
  SELECT
    id,
    timestamp,
    subject,
    endpoint,
    device_id,
    result,
    reason
  FROM audit_logs
  ORDER BY id DESC
  LIMIT 20
`).all();

console.table(logs);

db.close();
