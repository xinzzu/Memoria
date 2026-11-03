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

export interface GitStatus {
  branch: string | null;
  /** File yang berubah/belum ter-commit — sinyal paling akurat "pekerjaan terakhir". */
  dirty: string[];
  ahead: number;
  behind: number;
}

/**
 * Branch aktif + working tree yang kotor, via `git status --porcelain=v1 -b`.
 * Dipakai blok "LANJUTAN SESI" untuk menjawab: sedang di mana dan sedang
 * menyentuh apa saat user berpindah tool.
 */
export function runGitStatus(repoPath: string, maxFiles = 8): Promise<GitStatus> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain=v1", "-b"],
      { cwd: repoPath, timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ branch: null, dirty: [], ahead: 0, behind: 0 });
        const lines = stdout.split("\n").filter((l) => l.trim());
        let branch: string | null = null;
        let ahead = 0;
        let behind = 0;
        const dirty: string[] = [];
        for (const l of lines) {
          if (l.startsWith("##")) {
            // Contoh: "## feat/auth...origin/feat/auth [ahead 1, behind 2]"
            const m = l.match(/^##\s+([^\s.]+)/);
            if (m) branch = m[1];
            const a = l.match(/ahead (\d+)/);
            if (a) ahead = Number(a[1]);
            const b = l.match(/behind (\d+)/);
            if (b) behind = Number(b[1]);
            continue;
          }
          // Format porcelain: XY <path> (X staged, Y unstaged)
          const pathPart = l.slice(3).trim();
          if (pathPart) dirty.push(pathPart.replace(/^"|"$/g, ""));
        }
        resolve({ branch, dirty: dirty.slice(0, maxFiles), ahead, behind });
      }
    );
  });
}