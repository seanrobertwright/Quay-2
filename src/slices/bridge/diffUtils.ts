export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface FileChangeRecord {
  id: string;
  filePath: string;
  fileName: string;
  tool: "Edit" | "Write" | string;
  terminalId: string;
  ts: number;
  oldString?: string;
  newString?: string;
  content?: string;
  additions: number;
  deletions: number;
}

/**
 * Computes a line-by-line diff between two strings
 */
export function computeLineDiff(oldStr: string = "", newStr: string = ""): {
  lines: DiffLine[];
  additions: number;
  deletions: number;
} {
  const oldLines = oldStr.split(/\r?\n/);
  const newLines = newStr.split(/\r?\n/);

  // If oldStr is empty, all lines are added
  if (!oldStr && newStr) {
    const lines: DiffLine[] = newLines.map((content, idx) => ({
      type: "added",
      newLineNumber: idx + 1,
      content,
    }));
    return { lines, additions: newLines.length, deletions: 0 };
  }

  // If newStr is empty, all lines are removed
  if (oldStr && !newStr) {
    const lines: DiffLine[] = oldLines.map((content, idx) => ({
      type: "removed",
      oldLineNumber: idx + 1,
      content,
    }));
    return { lines, additions: 0, deletions: oldLines.length };
  }

  let additions = 0;
  let deletions = 0;

  // Simple Longest Common Subsequence (LCS) line diff for high readability
  const m = oldLines.length;
  const n = newLines.length;

  // For small to medium blocks (Claude edits are typically 1-100 lines), standard LCS matrix is instant
  if (m <= 500 && n <= 500) {
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (oldLines[i] === newLines[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    // Backtrack to build diff
    let i = m;
    let j = n;
    const temp: DiffLine[] = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        temp.push({
          type: "unchanged",
          oldLineNumber: i,
          newLineNumber: j,
          content: oldLines[i - 1],
        });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        temp.push({
          type: "added",
          newLineNumber: j,
          content: newLines[j - 1],
        });
        additions++;
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        temp.push({
          type: "removed",
          oldLineNumber: i,
          content: oldLines[i - 1],
        });
        deletions++;
        i--;
      }
    }

    temp.reverse();
    return { lines: temp, additions, deletions };
  } else {
    // Fallback block replacement for extremely large chunks
    const result: DiffLine[] = [];
    oldLines.forEach((content, idx) => {
      result.push({ type: "removed", oldLineNumber: idx + 1, content });
      deletions++;
    });
    newLines.forEach((content, idx) => {
      result.push({ type: "added", newLineNumber: idx + 1, content });
      additions++;
    });
    return { lines: result, additions, deletions };
  }
}
