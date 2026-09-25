const fs = require("fs");
const path = require("path");

const collections = [
  "users",
  "servers",
  "channels",
  "messages",
  "friendships",
  "notifications",
  "reports",
  "moderationActions",
];

function createStore(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const file = path.join(dataDirectory, "db.json");
  const empty = Object.fromEntries(collections.map((key) => [key, []]));

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(empty, null, 2));
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of collections) {
    if (!Array.isArray(data[key])) data[key] = [];
  }

  function save() {
    const temporaryFile = `${file}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2));
    fs.renameSync(temporaryFile, file);
  }

  return { data, save };
}

module.exports = { createStore };
