import { test } from "node:test";
import assert from "node:assert/strict";
import { urlsWritten } from "../../src/lib/explore-save.mjs";

const offer = (url) => ({ url });

test("a writer error is thrown instead of a silent zero", () => {
  assert.throws(
    () => urlsWritten([offer("https://jobs.example/1")], { added: 0, error: "pipeline writer missing" }),
    { message: "pipeline writer missing" },
  );
});

test("only the http(s) offers the writer accepted are returned", () => {
  const offers = [offer("https://jobs.example/1"), offer("mailto:jobs@example.com"), offer("https://jobs.example/2")];
  assert.deepEqual(urlsWritten(offers, { added: 2 }), ["https://jobs.example/1", "https://jobs.example/2"]);
});

test("a count that does not match the http(s) list marks nothing", () => {
  assert.deepEqual(urlsWritten([offer("https://jobs.example/1"), offer("https://jobs.example/2")], { added: 1 }), []);
});

test("nothing saved returns an empty list", () => {
  assert.deepEqual(urlsWritten([offer("mailto:jobs@example.com")], { added: 0 }), []);
  assert.deepEqual(urlsWritten([], { added: 0 }), []);
});
