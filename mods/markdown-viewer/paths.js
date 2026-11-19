// Pure helpers for the markdown viewer: which dropped paths count, and where a relative link points.

export const isMarkdown = (path) => /\.(md|markdown|mdx)$/i.test(path);

export const baseName = (path) => path.split("/").pop() || path;

// A link inside `from` resolved to an absolute local path, or null when it is not a local file.
export function resolveLink(from, url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#")) return null;
  const clean = decodeURI(url.split("#")[0].split("?")[0]);
  if (!clean) return null;
  const parts = clean.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.filter(Boolean).join("/")}`;
}
