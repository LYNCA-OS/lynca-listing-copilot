#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildPilotPacket } from "../lib/listing/evaluation/typed-gold-annotation-pilot.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split(/=(.*)/s).slice(0, 2)));
const projectionPath = resolve(args["--projection"] || "artifacts/typed-gold-pilot20-2026-08-09/physical-only.json");
const manifestPath = resolve(args["--manifest"] || "artifacts/typed-gold-pilot20-2026-08-09/physical-only.manifest.json");
const packetPath = resolve(args["--packet"] || "artifacts/typed-gold-pilot20-2026-08-09/packet.json");
const receiptPath = resolve(args["--receipt"] || "docs/evaluation/typed-gold-pilot20-receipt-2026-08-09.json");
const [projectionBytes, manifestBytes] = await Promise.all([readFile(projectionPath), readFile(manifestPath)]);
const { packet, receipt } = buildPilotPacket({
  physicalProjection: JSON.parse(projectionBytes), projectionManifest: JSON.parse(manifestBytes)
});
await Promise.all([mkdir(dirname(packetPath), { recursive: true }), mkdir(dirname(receiptPath), { recursive: true })]);
await Promise.all([
  writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 }),
  writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
]);
await chmod(packetPath, 0o600);
console.log(JSON.stringify({ packet: packetPath, receipt: receiptPath, cards: packet.cards.length, labels_read: false }));
