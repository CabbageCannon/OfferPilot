import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

function blankPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(source);
  source += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}

test("文档上传、来源隔离与扫描 PDF 提示", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "interview-documents-"));
  process.env.DOCUMENTS_DATA_DIR = dataDir;
  const { createDocumentsRouter } = await import("../routes/documents");
  const { closeDocumentsStore, getDocument } = await import("./store");
  const app = express().use("/api", createDocumentsRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDocumentsStore();
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.DOCUMENTS_DATA_DIR;
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/documents`;
  const upload = (kind: string, filename: string, content: Blob) => {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", content, filename);
    return fetch(base, { method: "POST", body: form });
  };

  const uploaded = await upload("jd", "岗位.md", new Blob(["招聘：客户经理\n\n要求：沟通能力"], { type: "text/markdown" }));
  assert.equal(uploaded.status, 201);
  const { document } = await uploaded.json() as { document: { id: string; filename: string; extractedText: string; parseStatus: string } };
  assert.equal(document.filename, "岗位.md");
  assert.match(document.extractedText, /客户经理/);
  assert.equal(document.parseStatus, "ready");
  assert.equal(getDocument(document.id, "other-user"), null);
  const recovered = await fetch(`${base}/${document.id}`);
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json() as { document: { id: string } }).document.id, document.id);

  const mismatch = await upload("jd", "fake.pdf", new Blob(["not pdf"], { type: "application/pdf" }));
  assert.equal(mismatch.status, 422);
  assert.equal((await mismatch.json() as { code: string }).code, "INVALID_FILE_CONTENT");

  const wrongMime = await upload("jd", "job.txt", new Blob(["岗位要求"], { type: "application/pdf" }));
  assert.equal(wrongMime.status, 415);
  const oversized = await upload("jd", "job.txt", new Blob([Buffer.alloc(8 * 1024 * 1024 + 1)], { type: "text/plain" }));
  assert.equal(oversized.status, 413);

  const scanned = await upload("resume", "blank.pdf", new Blob([blankPdf()], { type: "application/pdf" }));
  assert.equal(scanned.status, 201);
  const { document: scanResult } = await scanned.json() as { document: { parseStatus: string; extractedText: string; message: string } };
  assert.equal(scanResult.parseStatus, "needs_ocr");
  assert.equal(scanResult.extractedText, "");
  assert.match(scanResult.message, /无法提取文字/);
});
