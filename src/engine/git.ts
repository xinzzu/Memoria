import { execFile } from "node:child_process";

export interface GitLogEntry {
  date: string;
  message: string;
}

export function runGitLog(repoPath: string, n = 15): Promise<GitLogEntry[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["log", `-${n}`, "--pretty=format:%ad|%s", "--date=short", "--no-decorate"],
      { cwd: repoPath, timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const lines = stdout
          .split("\n")
          .map((l) => {
            const i = l.indexOf("|");
            if (i < 0) return null;
            return { date: l.slice(0, i), message: l.slice(i + 1).trim() };
          })
          .filter((x): x is GitLogEntry => !!x);
        resolve(lines);
      }
    );
  });
}

export function isGitRepo(repoPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoPath, timeout: 3000, windowsHide: true }, (err, stdout) => {
      resolve(!err && stdout.trim() === "true");
    });
  });
}