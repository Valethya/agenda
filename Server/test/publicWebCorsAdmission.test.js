import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example";

const [
  { default: app, sessionStore },
  { connectDB },
  fixtures,
  publicWebConstants,
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/config/publicWeb.constants.js"),
]);

const { cleanTestData, teardown } = fixtures;
const { PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT } = publicWebConstants;

await connectDB();
await cleanTestData();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api`;

const preflight = (origin) => fetch(`${baseUrl}/services`, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "GET",
  },
});

test("6.2.6-B unknown public Origins are rate-limited before unbounded Mongo trust lookups", async () => {
  let aggregateLookups = 0;
  mongoose.set("debug", (collectionName, methodName) => {
    if (collectionName === "businessconfigs" && methodName === "aggregate") {
      aggregateLookups += 1;
    }
  });

  try {
    const statuses = [];
    for (let index = 0; index < PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT + 5; index += 1) {
      const response = await preflight(`https://unknown-${index}.example.test`);
      statuses.push(response.status);
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
    }

    assert.equal(statuses.slice(0, PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT).every((status) => status === 403), true);
    assert.equal(statuses.slice(PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT).every((status) => status === 429), true);
    assert.equal(aggregateLookups, PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT);
  } finally {
    mongoose.set("debug", false);
  }
});

test.after(async () => {
  await teardown(server, sessionStore);
});
