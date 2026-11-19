import test from "node:test";
import assert from "node:assert/strict";
import { isMarkdown, baseName, resolveLink } from "../mods/markdown-viewer/paths.js";

test("isMarkdown accepts markdown extensions only", () => {
  assert.ok(isMarkdown("/a/README.md"));
  assert.ok(isMarkdown("/a/notes.MARKDOWN"));
  assert.ok(isMarkdown("/a/page.mdx"));
  assert.ok(!isMarkdown("/a/app.js"));
  assert.ok(!isMarkdown("/a/md"));
});

test("baseName takes the last segment", () => {
  assert.equal(baseName("/a/b/c.md"), "c.md");
});

test("resolveLink resolves relative links against the file", () => {
  assert.equal(resolveLink("/docs/a/x.md", "y.md"), "/docs/a/y.md");
  assert.equal(resolveLink("/docs/a/x.md", "../b/y.md#top"), "/docs/b/y.md");
  assert.equal(resolveLink("/docs/a/x.md", "/abs/z.md"), "/abs/z.md");
  assert.equal(resolveLink("/docs/a/x.md", "my%20file.md"), "/docs/a/my file.md");
});

test("resolveLink ignores urls and anchors", () => {
  assert.equal(resolveLink("/docs/x.md", "https://a.b"), null);
  assert.equal(resolveLink("/docs/x.md", "#section"), null);
});
