/*
 * S3 (#1090): WeCom callback crypto — signature scheme, AES round-trip with
 * the documented plaintext structure, receiveId tenancy check, padding/
 * structure failure modes, and the minimal XML field extractor.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import {
  computeMsgSignature,
  decryptWecomMessage,
  encryptWecomMessage,
  extractXmlFields,
  verifyMsgSignature,
} from "../src/gateway/wecom-crypto.mjs";

// A valid EncodingAESKey is 43 base64 chars decoding (with "=") to 32 bytes.
const AES_KEY = randomBytes(32).toString("base64").slice(0, 43);
const CORP_ID = "ww1234567890abcdef";

test("msg_signature is the sha1 of the four sorted parts; verify is order-insensitive", () => {
  const signature = computeMsgSignature("tok", "1700000000", "nonce1", "cipher");
  assert.match(signature, /^[0-9a-f]{40}$/);
  assert.ok(verifyMsgSignature({ token: "tok", timestamp: "1700000000", nonce: "nonce1", encrypted: "cipher", signature }));
  assert.ok(!verifyMsgSignature({ token: "tok", timestamp: "1700000000", nonce: "nonce2", encrypted: "cipher", signature }));
  assert.ok(!verifyMsgSignature({ token: "tok", timestamp: "1700000000", nonce: "nonce1", encrypted: "cipher", signature: "0".repeat(40) }));
  assert.ok(!verifyMsgSignature({ token: "tok", timestamp: "1700000000", nonce: "nonce1", encrypted: "cipher", signature: "short" }));
});

test("encrypt/decrypt round-trips the documented plaintext structure", () => {
  const message = "<xml><Content><![CDATA[/status]]></Content></xml>";
  const encrypted = encryptWecomMessage({ encodingAesKey: AES_KEY, message, receiveId: CORP_ID });
  assert.equal(decryptWecomMessage({ encodingAesKey: AES_KEY, encrypted, receiveId: CORP_ID }), message);
});

test("multibyte content survives the length header (bytes, not chars)", () => {
  const message = "回复：任务已完成 ✅ — 中文多字节";
  const encrypted = encryptWecomMessage({ encodingAesKey: AES_KEY, message, receiveId: CORP_ID });
  assert.equal(decryptWecomMessage({ encodingAesKey: AES_KEY, encrypted, receiveId: CORP_ID }), message);
});

test("a ciphertext for another tenant fails closed (receiveId mismatch)", () => {
  const encrypted = encryptWecomMessage({ encodingAesKey: AES_KEY, message: "hi", receiveId: "ww_other_corp" });
  assert.throws(
    () => decryptWecomMessage({ encodingAesKey: AES_KEY, encrypted, receiveId: CORP_ID }),
    /wecom_receive_id_mismatch/,
  );
});

test("tampered ciphertext, wrong key, and junk are rejected without detail", () => {
  const encrypted = encryptWecomMessage({ encodingAesKey: AES_KEY, message: "hi", receiveId: CORP_ID });
  const tampered = Buffer.from(encrypted, "base64");
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptWecomMessage({ encodingAesKey: AES_KEY, encrypted: tampered.toString("base64"), receiveId: CORP_ID }));

  const otherKey = randomBytes(32).toString("base64").slice(0, 43);
  assert.throws(() => decryptWecomMessage({ encodingAesKey: otherKey, encrypted, receiveId: CORP_ID }));
  assert.throws(() => decryptWecomMessage({ encodingAesKey: "tooshort", encrypted, receiveId: CORP_ID }), /wecom_invalid_encoding_aes_key/);
  assert.throws(() => decryptWecomMessage({ encodingAesKey: AES_KEY, encrypted: "not-base64!!", receiveId: CORP_ID }));
});

test("extractXmlFields reads CDATA and entity-encoded fields, ignores everything else", () => {
  const xml = `<xml>
    <ToUserName><![CDATA[${CORP_ID}]]></ToUserName>
    <FromUserName><![CDATA[zhangsan]]></FromUserName>
    <CreateTime>1700000000</CreateTime>
    <MsgType><![CDATA[text]]></MsgType>
    <Content><![CDATA[/run git.status]]></Content>
    <MsgId>7000000000000000001</MsgId>
    <AgentID>1000002</AgentID>
  </xml>`;
  const fields = extractXmlFields(xml, ["ToUserName", "FromUserName", "CreateTime", "MsgType", "Content", "MsgId", "AgentID", "Missing"]);
  assert.equal(fields.FromUserName, "zhangsan");
  assert.equal(fields.Content, "/run git.status");
  assert.equal(fields.MsgId, "7000000000000000001");
  assert.equal(fields.Missing, undefined);

  const entityEncoded = extractXmlFields("<xml><Content>a &amp;&lt;b&gt; &quot;c&apos;</Content></xml>", ["Content"]);
  assert.equal(entityEncoded.Content, "a &<b> \"c'");

  // No DTD processing: a DOCTYPE is inert text, entities beyond the five are untouched.
  const doctype = extractXmlFields('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><xml><Content>&e;</Content></xml>', ["Content"]);
  assert.equal(doctype.Content, "&e;");
});
