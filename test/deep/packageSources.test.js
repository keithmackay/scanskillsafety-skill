"use strict";
// ABOUTME: Tests deciding whether a package source is its ecosystem's official registry and how to show it when it is not:
// ABOUTME: hosts, plain http, git forms, direct archives, local paths, package.json values, credentials never shown, and grouping.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { spawnSync } = require("child_process");
const path = require("path");
const { classifySource, classifyManifestValue, commitFrom, groupSources, MAX_SOURCE_ENTRIES, OFFICIAL_HOSTS } = require("../../src/deep/packageSources");

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
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/packages/x-1.0.whl", { direct: true }), offRegistry("url", "https://pypi.org/…/x-1.0.whl"));
  assert.deepEqual(classifySource("PyPI", "https://files.pythonhosted.org/simple", { role: "index" }), files);
  assert.deepEqual(classifySource("PyPI", "https://pypi.org/simple", { role: "find-links" }), pypi);
  assert.deepEqual(classifySource("PyPI", "https://files.pythonhosted.org/packages/", { role: "find-links" }), files);
  assert.deepEqual(classifySource("npm", "https://registry.npmjs.org/", { role: "index" }), EXPECTED);
});

test("pypi.org's index is read from the text as pip sends it: dot segments written as %2e, user info, a path past /simple or another case of /simple are not the index", () => {
  const pypi = offRegistry("host", "https://pypi.org");
  for (const text of ["https://pypi.org/project/evil/%2e%2e/%2e%2e/simple/", "https://pypi.org/simple/%2e", "https://pypi.org/simple/%2E%2E/project/evil/",
    "https://user@pypi.org/simple", "https://pypi.org/./simple/", "https://pypi.org/simplex", "https://pypi.org/SIMPLE", "https://pypi.org/Simple/"]) {
    assert.deepEqual(classifySource("PyPI", text, { role: "index" }), pypi, text);
  }
  for (const text of ["https://pypi.org/simple", "https://pypi.org:443/simple/", "https://pypi.org/simple?x=1", "https://pypi.org/simple/#top", "HTTPS://PyPI.org/simple/"]) {
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

test("a direct archive on another host is kind url, shown with only its file name from the path and the cut marked", () => {
  const result = classifySource("npm", "https://user:tok@npm-proxy.fury.io/SECRET/u/x.tgz?token=Q#frag", { direct: true });
  assert.deepEqual(result, offRegistry("url", "https://npm-proxy.fury.io/…/x.tgz"));
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

test("a direct archive's address marks a cut path with …; one at the top of its host's path is shown whole; on github.com the owner and repository stay", () => {
  assert.deepEqual(
    classifySource("PyPI", "https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl", { direct: true }),
    offRegistry("url", "https://github.com/KittenML/KittenTTS/releases/download/…/kittentts-0.8.1-py3-none-any.whl"),
  );
  assert.deepEqual(classifySource("PyPI", "https://files.example.com/x-1.0.whl", { direct: true }), offRegistry("url", "https://files.example.com/x-1.0.whl"));
  const github = (text) => classifySource("npm", text, { direct: true });
  assert.deepEqual(github("https://github.com/u/r/raw/main/dist/x-1.0.tgz"), offRegistry("url", "https://github.com/u/r/raw/…/x-1.0.tgz"));
  assert.deepEqual(github("https://github.com/u/r/archive/refs/tags/v1.tar.gz"), offRegistry("url", "https://github.com/u/r/archive/…/v1.tar.gz"));
  assert.deepEqual(github("https://github.com/u/r/releases/download/v1/x.tgz"), offRegistry("url", "https://github.com/u/r/releases/download/…/x.tgz"));
  assert.deepEqual(github("https://user:TOKEN@github.com/u/r/raw/main/x.tgz?token=Q"), offRegistry("url", "https://github.com/u/r/raw/…/x.tgz"));
  assert.deepEqual(github("https://github.com/u/r%2Fx/raw/main/x.tgz"), offRegistry("url", "https://github.com/…/x.tgz"));
  assert.deepEqual(github("https://codeload.github.com/u/r/tar.gz/main"), offRegistry("url", "https://codeload.github.com/…/main"));
});

test("a direct address ending in a slash is shown by its last named segment, with the slash; one with no named segment by its host", () => {
  const url = (text) => classifySource("npm", text, { direct: true });
  assert.deepEqual(url("https://h.example/a/b/"), offRegistry("url", "https://h.example/…/b/"));
  assert.deepEqual(url("https://h.example/a/b//"), offRegistry("url", "https://h.example/…/b/"));
  assert.deepEqual(url("https://h.example/b/"), offRegistry("url", "https://h.example/b/"));
  assert.deepEqual(url("https://h.example/"), offRegistry("url", "https://h.example"));
  assert.deepEqual(url("https://h.example//"), offRegistry("url", "https://h.example"));
  assert.deepEqual(url("https://h.example"), offRegistry("url", "https://h.example"));
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

test("package.json: a value npm reads as a path, one with a slash that is no git form or an archive's file name, is local", () => {
  for (const value of ["libs/a/b", "@s/x", "x-1.0.0.tgz", "dist/sub/x-1.0.0.tar.gz", "x.TAR"]) {
    assert.deepEqual(classifyManifestValue("npm", value), LOCAL, value);
  }
  assert.deepEqual(classifyManifestValue("npm", "u/r"), offRegistry("git", "https://github.com/u/r"));
  assert.deepEqual(classifyManifestValue("npm", "1.x.tgz-beta"), EXPECTED);
});

test("package.json: a value npm reads as a file spec, starting with a dot, ~/, / or a drive letter, is local whatever follows", () => {
  for (const value of [".", "..", ".hidden", "~/x", "/x", "C:/x", "c:foo"]) {
    assert.deepEqual(classifyManifestValue("npm", value), LOCAL, value);
  }
});

test("package.json: an http(s) URL naming a repository on GitHub, GitLab or Bitbucket is git, with its commit; an archive on those hosts is a url", () => {
  const cases = [
    ["https://github.com/u/r", offRegistry("git", "https://github.com/u/r")],
    [`https://github.com/u/r.git#${SHA1}`, offRegistry("git", "https://github.com/u/r.git", { commit: SHA1 })],
    [`https://github.com/u/r/tree/${SHA1}`, offRegistry("git", "https://github.com/u/r", { commit: SHA1 })],
    ["https://github.com/u/r#main", offRegistry("git", "https://github.com/u/r")],
    ["http://github.com/u/r", offRegistry("git", "http://github.com/u/r")],
    ["https://gitlab.com/g/sub/r", offRegistry("git", "https://gitlab.com/g/sub/r")],
    ["https://bitbucket.org/u/r.git", offRegistry("git", "https://bitbucket.org/u/r.git")],
    ["https://github.com/u/r/archive/v1.tar.gz", offRegistry("url", "https://github.com/u/r/archive/v1.tar.gz")],
    ["https://gitlab.com/g/r/-/archive/v1/r-v1.tar.gz", offRegistry("url", "https://gitlab.com/…/r-v1.tar.gz")],
    ["https://bitbucket.org/u/r/get/v1.tar.gz", offRegistry("url", "https://bitbucket.org/…/v1.tar.gz")],
    ["https://codeload.github.com/u/r/tar.gz/main", offRegistry("url", "https://codeload.github.com/…/main")],
    ["https://gist.github.com/u/abc123", offRegistry("git", "https://gist.github.com/abc123")],
    [`https://gist.github.com/abc123#${SHA1}`, offRegistry("git", "https://gist.github.com/abc123", { commit: SHA1 })],
    ["https://gist.github.com/u/abc123/raw/x.tgz", offRegistry("url", "https://gist.github.com/…/x.tgz")],
  ];
  for (const [value, expected] of cases) assert.deepEqual(classifyManifestValue("npm", value), expected, value);
});

test("package.json: sourcehut shorthand and git.sr.ht URLs are git", () => {
  assert.deepEqual(classifyManifestValue("npm", "sourcehut:~u/r"), offRegistry("git", "https://git.sr.ht/~u/r"));
  assert.deepEqual(classifyManifestValue("npm", "https://git.sr.ht/~u/r"), offRegistry("git", "https://git.sr.ht/~u/r"));
  assert.deepEqual(classifyManifestValue("npm", `https://git.sr.ht/~u/r#${SHA1}`), offRegistry("git", "https://git.sr.ht/~u/r", { commit: SHA1 }));
  assert.deepEqual(classifyManifestValue("npm", "https://git.sr.ht/~u/r/archive/v1.tar.gz"), offRegistry("url", "https://git.sr.ht/…/v1.tar.gz"));
});

test("package.json: a backslash is a path separator to npm, so such a value is a path", () => {
  for (const value of ["a\\..\\..\\x", "C:\\x", "\\\\host\\share\\x"]) assert.deepEqual(classifyManifestValue("npm", value), LOCAL, value);
});

test("package.json: a value npm would read as a path only because of a leading space or =, and an alias of anything but a registry range, are sources it could not read", () => {
  for (const value of [" github:u/r", "=github:u/r", "  ./../../a", "\tgithub:u/r", "npm:y@github:u/r", "npm:y@https://e.example/y.tgz", "npm:x@npm:y@1", "npm:y@file:../z"]) {
    assert.deepEqual(classifyManifestValue("npm", value), UNREAD_SOURCE, JSON.stringify(value));
  }
  for (const value of ["=1.2.3", " ^1", "npm:y@^1", "npm:@s/y@1.x"]) assert.deepEqual(classifyManifestValue("npm", value), EXPECTED, JSON.stringify(value));
});

// Grouping

const MIRROR = "https://registry.npmmirror.com";
const hosted = (file, line, name, extra = {}) => ({ ecosystem: "npm", file, line, name, version: "1.0.0", kind: "host", address: MIRROR, ...extra });
const gitItem = (file, line, name, address, extra = {}) => ({ ecosystem: "npm", file, line, name, version: null, kind: "git", address, ...extra });

test("at most 100 entries are kept", () => {
  assert.equal(MAX_SOURCE_ENTRIES, 100);
});

test("packages from one host in one file are one entry: its first line, the first five packages and the total", () => {
  const sourced = Array.from({ length: 1000 }, (_, k) => hosted("package-lock.json", 10 + k, `p${k}`));
  assert.deepEqual(groupSources(sourced), {
    entries: [{
      ecosystem: "npm", kind: "host", address: MIRROR, file: "package-lock.json", line: 10,
      packages: [0, 1, 2, 3, 4].map((k) => ({ name: `p${k}`, version: "1.0.0", line: 10 + k })),
      total: 1000,
    }],
    more: { packages: 0, lines: 0 },
  });
});

test("groups are per file, kind and address; unreadable sources are one group per file; git, url and bundled addresses each their own", () => {
  const sourced = [
    hosted("a/package-lock.json", 3, "x"),
    hosted("package-lock.json", 5, "x"),
    hosted("package-lock.json", 6, "y", { kind: "http", address: "http://registry.npmmirror.com" }),
    hosted("package-lock.json", 7, "z"),
    { ecosystem: "npm", file: "package-lock.json", line: 8, name: null, version: null, kind: "unreadable", address: null },
    { ecosystem: "npm", file: "package-lock.json", line: 9, name: "u", version: "1.0.0", kind: "unreadable", address: null },
    gitItem("package-lock.json", 10, "g1", "https://github.com/u/one", { commit: SHA1 }),
    gitItem("package-lock.json", 11, "g2", "https://github.com/u/two"),
    { ecosystem: "npm", file: "package-lock.json", line: 12, name: "o", version: null, kind: "url", address: null, text: "a path outside the project" },
    { ecosystem: "npm", file: "package-lock.json", line: 13, name: "b", version: null, kind: "bundled", address: "vendor/b.tgz", text: "a bundled package file the scan cannot read" },
  ];
  const { entries, more } = groupSources(sourced);
  assert.deepEqual(more, { packages: 0, lines: 0 });
  assert.deepEqual(entries, [
    { ecosystem: "npm", kind: "host", address: MIRROR, file: "a/package-lock.json", line: 3, packages: [{ name: "x", version: "1.0.0", line: 3 }], total: 1 },
    { ecosystem: "npm", kind: "host", address: MIRROR, file: "package-lock.json", line: 5, packages: [{ name: "x", version: "1.0.0", line: 5 }, { name: "z", version: "1.0.0", line: 7 }], total: 2 },
    { ecosystem: "npm", kind: "http", address: "http://registry.npmmirror.com", file: "package-lock.json", line: 6, packages: [{ name: "y", version: "1.0.0", line: 6 }], total: 1 },
    { ecosystem: "npm", kind: "unreadable", address: null, file: "package-lock.json", line: 8, packages: [{ name: null, version: null, line: 8 }, { name: "u", version: "1.0.0", line: 9 }], total: 2 },
    { ecosystem: "npm", kind: "git", address: "https://github.com/u/one", file: "package-lock.json", line: 10, commit: SHA1, packages: [{ name: "g1", version: null, line: 10 }], total: 1 },
    { ecosystem: "npm", kind: "git", address: "https://github.com/u/two", file: "package-lock.json", line: 11, packages: [{ name: "g2", version: null, line: 11 }], total: 1 },
    { ecosystem: "npm", kind: "url", address: null, file: "package-lock.json", line: 12, text: "a path outside the project", packages: [{ name: "o", version: null, line: 12 }], total: 1 },
    { ecosystem: "npm", kind: "bundled", address: "vendor/b.tgz", file: "package-lock.json", line: 13, text: "a bundled package file the scan cannot read", packages: [{ name: "b", version: null, line: 13 }], total: 1 },
  ]);
});

test("one git address at two commits, or a url with no address for two reasons, is two entries", () => {
  const other = "f".repeat(40);
  const { entries } = groupSources([
    gitItem("package.json", 2, "a", "https://github.com/u/r", { commit: SHA1 }),
    gitItem("package.json", 3, "b", "https://github.com/u/r", { commit: other }),
    { ecosystem: "npm", file: "package.json", line: 4, name: "c", version: null, kind: "url", address: null, text: "a script that produces the package" },
    { ecosystem: "npm", file: "package.json", line: 5, name: "d", version: null, kind: "url", address: null, text: "a path outside the project" },
  ]);
  assert.deepEqual(entries.map((e) => [e.line, e.commit, e.text]), [[2, SHA1, undefined], [3, other, undefined], [4, undefined, "a script that produces the package"], [5, undefined, "a path outside the project"]]);
});

test("each config or requirements line is its own entry with no packages, keeping where it came from, its scope and its text", () => {
  const sourced = [
    { ecosystem: "npm", file: ".npmrc", line: 1, from: "config", kind: "host", address: "https://npm.example.com" },
    { ecosystem: "npm", file: ".npmrc", line: 2, from: "config", kind: "host", address: "https://npm.example.com", scope: "@myco" },
    { ecosystem: "PyPI", file: "requirements.txt", line: 1, from: "requirements", kind: "host", address: null, text: "an index set from an environment variable" },
  ];
  assert.deepEqual(groupSources(sourced).entries, [
    { ecosystem: "npm", kind: "host", address: "https://npm.example.com", file: ".npmrc", line: 1, from: "config", packages: [], total: 0 },
    { ecosystem: "npm", kind: "host", address: "https://npm.example.com", file: ".npmrc", line: 2, from: "config", scope: "@myco", packages: [], total: 0 },
    { ecosystem: "PyPI", kind: "host", address: null, file: "requirements.txt", line: 1, from: "requirements", text: "an index set from an environment variable", packages: [], total: 0 },
  ]);
});

test("entries are in file and line order whatever order the items come in, each at its first line", () => {
  const sourced = [
    hosted("requirements.txt", 9, "late"),
    hosted("b/package-lock.json", 4, "x"),
    hosted("a/package-lock.json", 30, "y"),
    hosted("a/package-lock.json", 7, "z"),
    { ecosystem: "PyPI", file: "requirements.txt", line: 2, from: "requirements", kind: "unreadable", address: null },
  ];
  const { entries } = groupSources(sourced);
  assert.deepEqual(entries.map((e) => [e.file, e.line]), [["a/package-lock.json", 7], ["b/package-lock.json", 4], ["requirements.txt", 2], ["requirements.txt", 9]]);
  assert.deepEqual(entries[0].packages, [{ name: "z", version: "1.0.0", line: 7 }, { name: "y", version: "1.0.0", line: 30 }]);
});

test("past 100 entries, the packages and the setting lines of the entries left out are counted, the first 100 in file and line order kept", () => {
  const sourced = Array.from({ length: 150 }, (_, k) => gitItem("package.json", 150 - k, `g${150 - k}`, `https://github.com/u/r${150 - k}`)).concat([
    gitItem("package.json", 200, "again", "https://github.com/u/r150"),
    { ecosystem: "npm", file: "package.json", line: 300, from: "config", kind: "host", address: "https://npm.example.com" },
    { ecosystem: "PyPI", file: "requirements.txt", line: 1, from: "requirements", kind: "unreadable", address: null },
  ]);
  const { entries, more } = groupSources(sourced);
  assert.equal(entries.length, 100);
  assert.deepEqual(entries.map((e) => e.line), Array.from({ length: 100 }, (_, k) => k + 1));
  assert.deepEqual(more, { packages: 51, lines: 2 });
});

test("grouping keeps memory bounded by the entries kept, however many addresses the items hold", () => {
  const script = `
    const { groupSources } = require(${JSON.stringify(path.join(__dirname, "../../src/deep/packageSources"))});
    const addresses = Array.from({ length: 200000 }, (_, a) => "https://m" + a + ".example");
    const sourced = [];
    for (let k = 0; k < 1000000; k++) {
      sourced.push({ ecosystem: "npm", file: "package-lock.json", line: k + 1, name: "p", version: "1.0.0", kind: "host", address: addresses[k % 200000] });
    }
    global.gc();
    const before = process.memoryUsage().heapUsed;
    const grouped = groupSources(sourced);
    global.gc();
    const after = process.memoryUsage().heapUsed;
    process.stdout.write(JSON.stringify({ entries: grouped.entries.length, more: grouped.more, grownMb: (after - before) / 1048576 }));
  `;
  const run = spawnSync(process.execPath, ["--max-old-space-size=256", "--expose-gc", "-e", script], { encoding: "utf-8" });
  assert.equal(run.status, 0, run.stderr);
  const { entries, more, grownMb } = JSON.parse(run.stdout);
  assert.equal(entries, 100);
  assert.deepEqual(more, { packages: 1000000 - 100 * 5, lines: 0 });
  assert.ok(grownMb < 8, `grew by ${grownMb} MB`);
});

test("a package name longer than npm allows is cut to 214 characters, whole characters only, with an ellipsis", () => {
  const long = `${"a".repeat(213)}\u{1F600}${"b".repeat(100)}`;
  const { entries } = groupSources([hosted("package-lock.json", 1, long), hosted("package-lock.json", 2, "a".repeat(214))]);
  assert.deepEqual(entries[0].packages.map((p) => p.name), [`${"a".repeat(213)}\u{1F600}…`, "a".repeat(214)]);
});

test("items with no line sort before those with one, in file order, and still group", () => {
  const { entries } = groupSources([
    hosted("b.json", 4, "x"),
    hosted("b.json", null, "y"),
    hosted("a.json", undefined, "z"),
    hosted("b.json", undefined, "w"),
  ]);
  assert.deepEqual(entries.map((e) => [e.file, e.line, e.total]), [["a.json", undefined, 1], ["b.json", null, 3]]);
  assert.deepEqual(entries[1].packages.map((p) => p.name), ["y", "w", "x"]);
});
