import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/database/prisma";
import { notFound } from "@/lib/errors/service-error";
import { logger } from "@/lib/logging/logger";
import { AIError } from "./errors";
import { slotLabel } from "@/lib/agent/slots";
import { PLATFORM_LABELS } from "@/lib/errors/user-messages";
import { loadPostHistory } from "./history";
import { checkDraft, findDuplicates, findSimilarPast } from "./quality";
import { getAIProvider } from "./registry";
import { DRAFT_STYLES, type BrandContext, type CheckedDraft, type DraftStyle, type HistoryEntry, type PostDraft } from "./types";

// 品質チェックで問題があった案を作り直す回数
export const MAX_REGENERATIONS = 2;

async function loadBrand(userId: string, brandId?: string | null): Promise<BrandContext | null> {
  if (!brandId) return null;
  const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
  if (!brand) throw notFound("ブランド");
  return brand;
}

// 依頼した型の順に並べ替える。足りない・重複した型は null
function alignToStyles(drafts: PostDraft[], styles: DraftStyle[]): (PostDraft | null)[] {
  const pool = [...drafts];
  return styles.map((style) => {
    const i = pool.findIndex((d) => d.style === style);
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  });
}

// 投稿案を作る（既定は5つの型すべて）。品質チェックで問題があった案だけ、問題点を伝えて作り直させる
export async function generateDrafts(
  userId: string,
  input: { topic: string; objective?: string; brandId?: string | null; styles?: DraftStyle[] },
): Promise<{ drafts: CheckedDraft[]; model: string; provider: string; historyCount: number }> {
  const brand = await loadBrand(userId, input.brandId);
  // これまでの投稿（このアプリの投稿と、SNS から読み込んだ過去の投稿）
  const history: HistoryEntry[] = (await loadPostHistory(userId, input.brandId)).map((h) => ({
    label: `${slotLabel(h.date)} ${PLATFORM_LABELS[h.platform]}`,
    text: h.text,
  }));
  const styles = input.styles && input.styles.length > 0 ? input.styles : [...DRAFT_STYLES];
  const provider = getAIProvider();

  const result: (PostDraft | null)[] = styles.map(() => null);
  let pending = styles.map((_, i) => i);
  let feedback: { style: DraftStyle; issues: string[] }[] = [];
  let model = "";
  let lastErrors = new Map<number, string[]>();

  for (let attempt = 0; attempt <= MAX_REGENERATIONS && pending.length > 0; attempt++) {
    const requestStyles = pending.map((i) => styles[i]);
    const generated = await provider.generate({
      topic: input.topic,
      objective: input.objective,
      brand,
      styles: requestStyles,
      history,
      feedback,
    });
    model = generated.model;
    logger.info("ai.generate", {
      userId,
      provider: provider.name,
      model: generated.model,
      attempt,
      styles: requestStyles,
      usage: generated.usage,
    });

    alignToStyles(generated.drafts, requestStyles).forEach((draft, k) => {
      result[pending[k]] = draft;
    });

    // 品質チェック。作り直しが必要な案を集める
    const dup = findDuplicates(result.filter((d): d is PostDraft => d !== null));
    lastErrors = new Map();
    let filledIndex = -1;
    result.forEach((draft, i) => {
      if (!draft) {
        lastErrors.set(i, ["案が作られませんでした"]);
        return;
      }
      filledIndex++;
      const errors = [...checkDraft(draft, brand).errors, ...findSimilarPast(draft, history)];
      if (dup.has(filledIndex)) errors.push("他の案とXの文章が同じです。別の切り口にしてください");
      if (errors.length > 0) lastErrors.set(i, errors);
    });
    pending = [...lastErrors.keys()];
    feedback = pending.map((i) => ({ style: styles[i], issues: lastErrors.get(i) ?? [] }));
  }

  const drafts: CheckedDraft[] = [];
  result.forEach((draft, i) => {
    if (!draft) return;
    const { warnings } = checkDraft(draft, brand);
    drafts.push({ ...draft, id: randomUUID(), errors: lastErrors.get(i) ?? [], warnings });
  });
  if (drafts.length === 0) throw new AIError("INVALID_OUTPUT", "no drafts");
  return { drafts, model, provider: provider.name, historyCount: history.length };
}
