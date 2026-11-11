import type { MyersOp } from "@/db/schema";

/**
 * Word-level Myers-inspired edit script of `target` against `base`.
 * Uses LCS backtrack (equivalent edit script for our purposes).
 */
export function computeMyersOps(base: string[], target: string[]): MyersOp[] {
  const n = base.length;
  const m = target.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (base[i] === target[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const raw: Array<
    | { kind: "equal"; bi: number; ti: number }
    | { kind: "delete"; bi: number }
    | { kind: "insert"; bi: number; token: string }
  > = [];

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === target[j]) {
      raw.push({ kind: "equal", bi: i, ti: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ kind: "delete", bi: i });
      i += 1;
    } else {
      raw.push({ kind: "insert", bi: i, token: target[j] });
      j += 1;
    }
  }
  while (i < n) {
    raw.push({ kind: "delete", bi: i });
    i += 1;
  }
  while (j < m) {
    raw.push({ kind: "insert", bi: i, token: target[j] });
    j += 1;
  }

  return coalesce(raw);
}

function coalesce(
  raw: Array<
    | { kind: "equal"; bi: number; ti: number }
    | { kind: "delete"; bi: number }
    | { kind: "insert"; bi: number; token: string }
  >,
): MyersOp[] {
  const ops: MyersOp[] = [];
  let k = 0;
  while (k < raw.length) {
    const cur = raw[k];
    if (cur.kind === "equal") {
      let length = 1;
      while (
        k + length < raw.length &&
        raw[k + length].kind === "equal" &&
        (raw[k + length] as { bi: number }).bi === cur.bi + length
      ) {
        length += 1;
      }
      ops.push({ op: "equal", baseIndex: cur.bi, length });
      k += length;
      continue;
    }

    // Gather a replace/delete/insert run at the same baseIndex frontier
    let deletes = 0;
    const inserts: string[] = [];
    const baseIndex = cur.bi;
    while (k < raw.length) {
      const step = raw[k];
      if (step.kind === "equal") break;
      if (step.kind === "delete") {
        if (step.bi !== baseIndex + deletes) break;
        deletes += 1;
        k += 1;
      } else if (step.kind === "insert" && step.bi === baseIndex + deletes) {
        inserts.push(step.token);
        k += 1;
      } else {
        break;
      }
    }

    if (deletes > 0 && inserts.length > 0) {
      ops.push({
        op: "replace",
        baseIndex,
        length: deletes,
        tokens: inserts,
      });
    } else if (deletes > 0) {
      ops.push({ op: "delete", baseIndex, length: deletes });
    } else if (inserts.length > 0) {
      ops.push({ op: "insert", baseIndex, tokens: inserts });
    }
  }
  return ops;
}

/** Apply Myers ops to a base token list to reconstruct a manuscript verse. */
export function applyMyersOps(base: string[], ops: MyersOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === "equal") {
      out.push(...base.slice(op.baseIndex, op.baseIndex + op.length));
    } else if (op.op === "delete") {
      // skip
    } else if (op.op === "insert") {
      out.push(...op.tokens);
    } else if (op.op === "replace") {
      out.push(...op.tokens);
    }
  }
  return out;
}
