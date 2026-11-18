"use strict";
// ABOUTME: Tests deciding whether a package source is its ecosystem's official registry and how to show it when it is not:
// ABOUTME: hosts, plain http, git forms, direct archives, local paths, package.json values, and credentials never shown.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { classifySource, classifyManifestValue, commitFrom, OFFICIAL_HOSTS } = require("../../src/deep/packageSources");

const SHA1 = "0123456789abcdef0123456789abcdef01234567";
const EXPECTED = { expected: true };
const LOCAL = { expected: false, kind: "local" };
const UNREADABLE = { unreadable: true };
const offRegistry = (kind, address, extra = {}) => ({ expected: false, kind, address, ...extra });

test("the official hosts are npm's and Yarn's registry for npm, and PyPI's two hosts for PyPI", () => {
  assert.deepEqual(OFFICIAL_HOSTS, {
    npm: ["registry.npmjs.org", "registry.yarnpkg.com"],
    PyPI: ["pypi.org", "files.pythonhosted.org"],
  });
});

test("an npm registry tarball is expected, with :443, an upper-case host or a trailing slash too", () => {
  for (const text of [
    "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
    "https://registry.npmjs.org:443/lodash/-/lodash-4.17.21.tgz",
    "https://REGISTRY.NPMJS.ORG/lodash/-/lodash-4.17.21.tgz",
    "https://registry.npmjs.org/",
    "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz",
  ]) {
    assert.deepEqual(classifySource("npm", text), EXPECTED, text);
  }
});

test("PyPI's index, pypi.org at /simple, is expected where a field names an index; its file host is expected for package files", () => {
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/simple/", { role: "index" }), EXPECTED);
  assert.deepEqual(classifySource("PyPI", "https://PYPI.ORG:443/simple", { role: "index" }), EXPECTED);
  assert.deepEqual(classifySource("PyPI", "https://files.pythonhosted.org/packages/x.whl"), EXPECTED);
  assert.deepEqual(classifySource("PyPI", "https://files.pythonhosted.org/packages/x.whl", { direct: true }), EXPECTED);
});

test("pypi.org is official only as the index at /simple: another path, a package file there, or a find-links page on either PyPI host is not expected", () => {
  const pypi = offRegistry("host", "https://pypi.org");
  const files = offRegistry("host", "https://files.pythonhosted.org");
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/simple/"), pypi);
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/simple/requests/", { role: "index" }), pypi);
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/project/requests/", { role: "index" }), pypi);
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/packages/x-1.0.whl", { direct: true }), offRegistry("url", "https://pypi.org/x-1.0.whl"));
  assert.deepEqual(classifySource("PyPI", "https://files.pythonhosted.org/simple", { role: "index" }), files);
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/simple", { role: "find-links" }), pypi);
  assert.deepEqual(classifySource("PyPI", "https://files.pythonhosted.org/packages/", { role: "find-links" }), files);
  assert.deepEqual(classifySource("npm", "https://registry.npmjs.org/", { role: "index" }), EXPECTED);
});

test("pypi.org's index is read from the text as pip sends it: dot segments written as %2e, user info or a path past /simple are not the index", () => {
  const pypi = offRegistry("host", "https://pypi.org");
  for (const text of ["https://pypi.org/project/evil/%2e%2e/%2e%2e/simple/", "https://pypi.org/simple/%2e", "https://pypi.org/simple/%2E%2E/project/evil/",
    "https://user@pypi.org/simple", "https://pypi.org/./simple/", "https://pypi.org/simplex"]) {
    assert.deepEqual(classifySource("PyPI", text, { role: "index" }), pypi, text);
  }
  for (const text of ["https://pypi.org/simple", "https://pypi.org:443/simple/", "https://pypi.org/simple?x=1", "https://pypi.org/simple/#top"]) {
    assert.deepEqual(classifySource("PyPI", text, { role: "index" }), EXPECTED, text);
  }
});

test("another ecosystem's official host is not expected", () => {
  assert.deepEqual(classifySource("npm", "https://pypi.org/simple"), offRegistry("host", "https://pypi.org"));
});

test("an official host on another port is not expected", () => {
  assert.deepEqual(classifySource("npm", "https://registry.npmjs.org:8443/x"), offRegistry("host", "https://registry.npmjs.org:8443"));
});

test("plain http to the official host is kind http, shown as scheme and host", () => {
  assert.deepEqual(classifySource("npm", "http://registry.npmjs.org/x"), offRegistry("http", "http://registry.npmjs.org"));
});

test("plain http is kind http when direct too", () => {
  assert.deepEqual(classifySource("PyPI", "http://x.example/a/b/p.whl", { direct: true }), offRegistry("http", "http://x.example"));
});

test("a mirror is kind host, shown as scheme and host", () => {
  assert.deepEqual(
    classifySource("npm", "https://registry.npmmirror.com/lodash/-/lodash-4.17.21.tgz"),
    offRegistry("host", "https://registry.npmmirror.com"),
  );
});

test("a host address drops user info, the path, the query and the fragment", () => {
  const result = classifySource("npm", "https://user:tok@npm-proxy.fury.io/SECRET/u/x.tgz?token=Q#frag");
  assert.deepEqual(result, offRegistry("host", "https://npm-proxy.fury.io"));
  const json = JSON.stringify(result);
  for (const secret of ["user", "tok", "SECRET", "token", "Q", "frag"]) assert.ok(!json.includes(secret), secret);
});

test("a direct archive on another host is kind url, shown with only its file name from the path", () => {
  const result = classifySource("npm", "https://user:tok@npm-proxy.fury.io/SECRET/u/x.tgz?token=Q#frag", { direct: true });
  assert.deepEqual(result, offRegistry("url", "https://npm-proxy.fury.io/x.tgz"));
  const json = JSON.stringify(result);
  for (const secret of ["user", "tok", "SECRET", "token", "Q", "frag"]) assert.ok(!json.includes(secret), secret);
});

test("a direct archive on the official registry is expected", () => {
  assert.deepEqual(classifySource("npm", "https://registry.npmjs.org/x/-/x-1.0.0.tgz", { direct: true }), EXPECTED);
});

test("git+ssh is kind git, without user info, with the commit from a 40-hex fragment", () => {
  assert.deepEqual(
    classifySource("npm", `git+ssh://git@github.com/u/r.git#${SHA1}`),
    offRegistry("git", "ssh://github.com/u/r.git", { commit: SHA1 }),
  );
});

test("git+https with a branch fragment has no commit and never shows its token", () => {
  const result = classifySource("npm", "git+https://tok@github.com/u/r.git#main");
  assert.deepEqual(result, offRegistry("git", "https://github.com/u/r.git"));
  assert.ok(!JSON.stringify(result).includes("tok"));
});

test("git+http, git:// and ssh://git@ are kind git, with the transport in the address", () => {
  assert.deepEqual(classifySource("npm", "git+http://h.example/u/r.git"), offRegistry("git", "http://h.example/u/r.git"));
  assert.deepEqual(classifySource("npm", "git://h.example/u/r.git?x=1"), offRegistry("git", "git://h.example/u/r.git"));
  assert.deepEqual(classifySource("npm", "ssh://git@h.example/u/r"), offRegistry("git", "ssh://h.example/u/r"));
});

test("a 64-hex fragment is a commit too", () => {
  const sha256 = SHA1.slice(0, 32).repeat(2);
  assert.equal(classifySource("npm", `git+https://h.example/u/r.git#${sha256}`).commit, sha256);
});

test("scp-form git keeps the user only when it is git", () => {
  assert.deepEqual(classifySource("npm", "git@github.com:u/r.git"), offRegistry("git", "git@github.com:u/r.git"));
  assert.deepEqual(classifySource("npm", "deploy@host:u/r"), offRegistry("git", "host:u/r"));
});

test("scp-form git takes its commit from the fragment and drops the fragment from the address", () => {
  assert.deepEqual(classifySource("npm", `git@github.com:u/r.git#${SHA1}`), offRegistry("git", "git@github.com:u/r.git", { commit: SHA1 }));
});

test("hosting shorthands are kind git, shown as the repository's address", () => {
  assert.deepEqual(classifySource("npm", "github:u/r"), offRegistry("git", "https://github.com/u/r"));
  assert.deepEqual(classifySource("npm", "gitlab:u/r"), offRegistry("git", "https://gitlab.com/u/r"));
  assert.deepEqual(classifySource("npm", "bitbucket:u/r"), offRegistry("git", "https://bitbucket.org/u/r"));
  assert.deepEqual(classifySource("npm", "gist:abc123"), offRegistry("git", "https://gist.github.com/abc123"));
  assert.deepEqual(classifySource("npm", `github:u/r#${SHA1}`), offRegistry("git", "https://github.com/u/r", { commit: SHA1 }));
});

test("commitFrom takes a 40- or 64-hex fragment or a commit= fragment, and nothing else", () => {
  assert.equal(commitFrom(`https://github.com/u/r.git#commit=${SHA1}`), SHA1);
  assert.equal(commitFrom(`x#${SHA1}`), SHA1);
  assert.equal(commitFrom("x#main"), null);
  assert.equal(commitFrom(`x#commit=${SHA1}0`), null);
  assert.equal(commitFrom(`x?commit=${SHA1}`), null);
  assert.equal(commitFrom("x"), null);
});

test("sources inside the project are local", () => {
  for (const text of ["file:../x", "./x", "../x", "/abs/x", "~/x", "link:../x", "workspace:*", "portal:../x", "catalog:"]) {
    assert.deepEqual(classifySource("npm", text), LOCAL, text);
  }
});

test("a source it cannot make out is unreadable", () => {
  for (const text of ["", "%%%", "https://", "ftp://h.example/x", "npm:4.17.21", "github:u", "github:tok@u/r"]) {
    assert.deepEqual(classifySource("npm", text), UNREADABLE, text);
  }
});

test("a 4 MB line of a@ is answered in bounded time", () => {
  const text = "a@".repeat(2 * 1024 * 1024);
  const start = performance.now();
  assert.deepEqual(classifySource("npm", text), UNREADABLE);
  assert.ok(performance.now() - start < 1000);
});

test("package.json: an npm alias is the registry", () => {
  assert.deepEqual(classifyManifestValue("npm", "npm:@s/p@^1"), EXPECTED);
});

test("package.json: catalog: and paths are local", () => {
  assert.deepEqual(classifyManifestValue("npm", "catalog:"), LOCAL);
  assert.deepEqual(classifyManifestValue("npm", "./vendor/p"), LOCAL);
});

test("package.json: GitHub shorthand with a ref is git", () => {
  assert.deepEqual(classifyManifestValue("npm", "u/r#semver:^1"), offRegistry("git", "https://github.com/u/r"));
});

test("package.json: scp-form git is git", () => {
  assert.deepEqual(classifyManifestValue("npm", "git@github.com:u/r.git"), offRegistry("git", "git@github.com:u/r.git"));
});

test("package.json: jsr: is fetched from npm.jsr.io", () => {
  assert.deepEqual(classifyManifestValue("npm", "jsr:@std/x"), offRegistry("host", "https://npm.jsr.io"));
});

test("package.json: a patch of an npm package is classified by the patched package, so the registry", () => {
  assert.deepEqual(classifyManifestValue("npm", "patch:lodash@npm%3A4.17.21#./p.patch"), EXPECTED);
});

test("package.json: a patch of a git package is git", () => {
  assert.deepEqual(
    classifyManifestValue("npm", "patch:p@github%3Au%2Fr#./p.patch"),
    offRegistry("git", "https://github.com/u/r"),
  );
});

test("package.json: exec: is a url with no address and a fixed text", () => {
  assert.deepEqual(classifyManifestValue("npm", "exec:./x"), {
    expected: false,
    kind: "url",
    address: null,
    text: "a script that produces the package",
  });
});

test("package.json: an https tarball is a url, an http one http", () => {
  assert.deepEqual(classifyManifestValue("npm", "https://x.example/p.tgz"), offRegistry("url", "https://x.example/p.tgz"));
  assert.deepEqual(classifyManifestValue("npm", "http://x.example/p.tgz"), offRegistry("http", "http://x.example"));
});

test("package.json: ranges and tags are the registry", () => {
  for (const value of ["^1.2.3", "latest", "1.x || >=2.5.0", "*", ""]) {
    assert.deepEqual(classifyManifestValue("npm", value), EXPECTED, value);
  }
});

test("git+ssh with an scp-style colon after the host is git, shown in scp form, with its commit", () => {
  assert.deepEqual(classifySource("npm", "git+ssh://git@github.com:u/r.git"), offRegistry("git", "git@github.com:u/r.git"));
  assert.deepEqual(
    classifySource("npm", `git+ssh://git@github.com:u/r.git#${SHA1}`),
    offRegistry("git", "git@github.com:u/r.git", { commit: SHA1 }),
  );
  assert.deepEqual(classifySource("npm", "ssh://deploy@host:u/r"), offRegistry("git", "host:u/r"));
});

test("GitLab shorthand keeps its subgroups", () => {
  assert.deepEqual(classifySource("npm", "gitlab:group/sub/r"), offRegistry("git", "https://gitlab.com/group/sub/r"));
});

test("gist shorthand with a user is shown by the gist's id", () => {
  assert.deepEqual(classifySource("npm", "gist:u/abc123"), offRegistry("git", "https://gist.github.com/abc123"));
});

test("package.json: git+ssh with an scp-style colon is git, with or without a ref", () => {
  for (const value of ["git+ssh://git@github.com:u/r.git", "git+ssh://git@github.com:u/r.git#semver:^1"]) {
    assert.deepEqual(classifyManifestValue("npm", value), offRegistry("git", "git@github.com:u/r.git"), value);
  }
});

test("package.json: GitLab subgroups and a gist with a user are git", () => {
  assert.deepEqual(classifyManifestValue("npm", "gitlab:group/sub/r"), offRegistry("git", "https://gitlab.com/group/sub/r"));
  assert.deepEqual(classifyManifestValue("npm", "gist:u/abc123"), offRegistry("git", "https://gist.github.com/abc123"));
});

test("package.json: a git form it cannot read is git with no address and a fixed text, never the registry or the raw value", () => {
  const unread = { expected: false, kind: "git", address: null, text: "a git source it could not read" };
  for (const value of ["git+file:///tmp/r", "git+https://", "git://", "ssh://", "github:u/r/x", "bitbucket:u", "GitHub:tok@u/r"]) {
    assert.deepEqual(classifyManifestValue("npm", value), unread, value);
  }
});

test("package.json: an http(s) address it cannot read has no address and a fixed text, never the registry", () => {
  assert.deepEqual(classifyManifestValue("npm", "https://"), { expected: false, kind: "url", address: null, text: "an address it could not read" });
  assert.deepEqual(classifyManifestValue("npm", "http://"), { expected: false, kind: "http", address: null, text: "an address it could not read" });
});

const UNREAD_GIT = { expected: false, kind: "git", address: null, text: "a git source it could not read" };
const UNREAD_SOURCE = { expected: false, kind: "url", address: null, text: "a source it could not read" };
const SCP_WITH_BAD_PATHS = ["git@host:u/r\nFAKE", "git@host:u/\x1b[31mred", "git@host:tok:pw/r", "git@host:/abs/r", "git@host:u//r"];

test("scp-form git whose path has a character outside a name is unreadable", () => {
  for (const text of SCP_WITH_BAD_PATHS) assert.deepEqual(classifySource("npm", text), UNREADABLE, JSON.stringify(text));
});

test("package.json: scp-form git whose path has a character outside a name is git with a fixed text, never the raw path", () => {
  for (const value of SCP_WITH_BAD_PATHS) assert.deepEqual(classifyManifestValue("npm", value), UNREAD_GIT, JSON.stringify(value));
});

test("an ssh URL with a password and an scp-style colon is unreadable", () => {
  assert.deepEqual(classifySource("npm", "ssh://user:pw@host:u/r"), UNREADABLE);
});

test("GitLab shorthand with an empty last segment is unreadable", () => {
  assert.deepEqual(classifySource("npm", "gitlab:g/r/"), UNREADABLE);
});

test("package.json: a patch nested past two levels is a source it could not read", () => {
  assert.deepEqual(classifyManifestValue("npm", "patch:a@patch:b@^1#./q.patch#./p.patch"), EXPECTED);
  assert.deepEqual(classifyManifestValue("npm", "patch:a@patch:b@patch:c@^1"), UNREAD_SOURCE);
});

test("package.json: 16,000 nested patches are answered in bounded time", () => {
  const value = "patch:a@".repeat(16_000) + "^1";
  const start = performance.now();
  assert.deepEqual(classifyManifestValue("npm", value), UNREAD_SOURCE);
  assert.ok(performance.now() - start < 1000);
});

test("package.json: a patch with no package name is a source it could not read", () => {
  assert.deepEqual(classifyManifestValue("npm", "patch:github%3Au%2Fr#x"), UNREAD_SOURCE);
});

test("package.json: file: and npm: are read in any case, as npm reads them", () => {
  assert.deepEqual(classifyManifestValue("npm", "FILE:../x"), LOCAL);
  assert.deepEqual(classifyManifestValue("npm", "NPM:@s/p@^1"), EXPECTED);
});

test("package.json: 4 MB values are answered in bounded time", () => {
  for (const value of ["a@".repeat(2 * 1024 * 1024), "git@h:" + "a/".repeat(2 * 1024 * 1024), "a/".repeat(2 * 1024 * 1024)]) {
    const start = performance.now();
    classifyManifestValue("npm", value);
    assert.ok(performance.now() - start < 1000);
  }
});
