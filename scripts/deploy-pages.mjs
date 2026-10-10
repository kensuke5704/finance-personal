import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(new URL("..", import.meta.url).pathname);
const run = (program, args, cwd = repo) => execFileSync(program, args, { cwd, stdio: "inherit" });
run("npm", ["run", "pages:build"]);
const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).trim();
const directory = mkdtempSync(join(tmpdir(), "finance-personal-pages-"));
const existing = execFileSync("git", ["ls-remote", "--heads", remote, "gh-pages"], { cwd: repo, encoding: "utf8" }).trim();
if (existing) {
  run("git", ["clone", "--depth", "1", "--branch", "gh-pages", remote, directory]);
  for (const entry of readdirSync(directory)) {
    if (entry !== ".git") rmSync(join(directory, entry), { recursive: true, force: true });
  }
} else {
  run("git", ["init", "-b", "gh-pages"], directory);
  run("git", ["remote", "add", "origin", remote], directory);
}
const output = join(repo, "out");
if (!existsSync(join(output, "index.html"))) throw new Error("Build output is missing.");
cpSync(output, directory, { recursive: true });
run("git", ["add", "."], directory);
const changes = execFileSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" }).trim();
if (changes) {
  run("git", ["commit", "-m", `Publish Finance Personal ${new Date().toISOString()}`], directory);
  run("git", ["push", "origin", "gh-pages"], directory);
}
console.log("Published: https://kensuke5704.github.io/finance-personal/");
