import assert from "node:assert/strict";
import { Readable } from "node:stream";
import handler from "../api/login.js";

function makeRequest(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  req.headers = {
    host: "example.test",
    "x-forwarded-proto": "https",
    "content-type": "application/json"
  };
  return req;
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || "";
    }
  };
}

async function login() {
  const res = makeResponse();
  await handler(makeRequest({
    username: "metaverse",
    password: "mtv"
  }), res);
  assert.equal(res.statusCode, 200);
  const cookie = String(res.headers["set-cookie"] || "");
  assert.match(cookie, /lynca_metaverse_session=/);
  const token = cookie.match(/lynca_metaverse_session=([^;]+)/)?.[1] || "";
  const [payload] = token.split(".");
  const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(session.user, "metaverse");
  assert.match(session.sid, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof session.iat, "number");
  assert.equal(typeof session.exp, "number");
  return { cookie, session };
}

const previousEnv = {
  METAVERSE_USERNAME: process.env.METAVERSE_USERNAME,
  METAVERSE_PASSWORD: process.env.METAVERSE_PASSWORD,
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  API_RATE_LIMIT_DISABLED: process.env.API_RATE_LIMIT_DISABLED
};

process.env.METAVERSE_USERNAME = "metaverse";
process.env.METAVERSE_PASSWORD = "mtv";
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.API_RATE_LIMIT_DISABLED = "1";

try {
  const first = await login();
  const second = await login();
  assert.notEqual(first.cookie, second.cookie);
  assert.notEqual(first.session.sid, second.session.sid);
  console.log("login session tests passed");
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
