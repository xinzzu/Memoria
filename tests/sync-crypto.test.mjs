/* Test M2 crypto: recovery code, passphrase wrapper, bundle format. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

const crypto = require("../dist/engine/sync/crypto.js");
const bundle = require("../dist/engine/sync/bundle.js");

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const OP = {
  opId: "dev:1",
  hlc: "0000000000001.000000.dev",
  entity: "memory",
  entityUid: "uid-1",
  op: "upsert",
  payload: { content: "hello" },
};

test("recovery code: roundtrip, normalisasi, dan group id stabil", () => {
  const code = crypto.encodeRecoveryCode(KEY);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){12}$/);
  assert.deepEqual(crypto.decodeRecoveryCode(code), KEY);
  assert.deepEqual(crypto.decodeRecoveryCode(code.replace(/-/g, "").toLowerCase()), KEY);
  assert.equal(crypto.decodeRecoveryCode(code).length, 32);
  assert.notEqual(crypto.groupIdFor(KEY), crypto.groupIdFor(Buffer.alloc(32, 7)));
  assert.equal(crypto.groupIdFor(KEY), crypto.groupIdFor(Buffer.from(KEY)));
  assert.throws(() => crypto.decodeRecoveryCode("too-short"), /52/);
  assert.throws(() => crypto.decodeRecoveryCode("U".repeat(52)), /invalid/);
  assert.throws(() => crypto.assertSyncKey(Buffer.alloc(16)), /32 bytes/);
});

test("passphrase wrapper: unlock benar, passphrase salah ditolak", () => {
  const stored = crypto.wrapKeyWithPassphrase(KEY, "correct horse");
  assert.ok(stored.startsWith("pass1:"));
  assert.ok(!stored.includes(KEY.toString("base64")), "kunci tidak boleh tersimpan polos");
  assert.deepEqual(crypto.unwrapKeyWithPassphrase(stored, "correct horse"), KEY);
  assert.throws(() => crypto.unwrapKeyWithPassphrase(stored, "wrong"), /Wrong passphrase/);
  const tampered = stored.slice(0, -4) + "AAAA";
  assert.throws(() => crypto.unwrapKeyWithPassphrase(tampered, "correct horse"));
  assert.throws(() => crypto.wrapKeyWithPassphrase(KEY, ""), /empty/);
});

test("bundle: roundtrip, header terautentikasi, tamper & wrong key ditolak", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-crypto-"));
  const file = path.join(dir, "test.memsync");
  const written = bundle.writeBundleFile(file, [OP], KEY, "dev");
  assert.ok(written.bytes > 0);
  const read = bundle.readBundleFile(file, KEY);
  assert.deepEqual(read.ops, [OP]);
  assert.equal(read.header.groupId, crypto.groupIdFor(KEY));
  assert.equal(read.header.opCount, 1);
  assert.equal(read.header.deviceId, "dev");
  assert.ok(read.header.hlcMin && read.header.hlcMax);

  const raw = fs.readFileSync(file);
  const tampered = Buffer.from(raw);
  tampered[tampered.length - 1] ^= 0xff;
  const badFile = path.join(dir, "tampered.memsync");
  fs.writeFileSync(badFile, tampered);
  assert.throws(() => bundle.readBundleFile(badFile, KEY), /wrong key or tampered/);

  const otherKey = crypto.generateGroupKey();
  assert.throws(() => bundle.readBundleFile(file, otherKey), /wrong key or tampered/);

  const dupFile = path.join(dir, "duplicate.memsync");
  bundle.writeBundleFile(dupFile, [OP, { ...OP }], KEY, "dev");
  assert.throws(() => bundle.readBundleFile(dupFile, KEY), /duplicate operation id/);

  const headerTampered = Buffer.from(raw);
  headerTampered[20] ^= 0x01;
  const badHeader = path.join(dir, "header.memsync");
  fs.writeFileSync(badHeader, headerTampered);
  assert.throws(() => bundle.readBundleFile(badHeader, KEY));
  fs.rmSync(dir, { recursive: true, force: true });
});
