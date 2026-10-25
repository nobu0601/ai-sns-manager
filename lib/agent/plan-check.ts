import { DRAFT_STYLES, type PlanItem } from "@/lib/ai/types";

// AI が作った計画が、投稿枠と投稿テーマの柱のルールを守っているか確認する
export function checkPlan(items: PlanItem[], slotCount: number, pillars: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (item.slotIndex < 0 || item.slotIndex >= slotCount) errors.push(`存在しない投稿枠 ${item.slotIndex} があります`);
    else if (seen.has(item.slotIndex)) errors.push(`投稿枠 ${item.slotIndex} が重複しています`);
    seen.add(item.slotIndex);
    if (!DRAFT_STYLES.includes(item.style)) errors.push(`型「${item.style}」は使えません`);
    if (pillars.length > 0 && !pillars.includes(item.pillar)) errors.push(`投稿テーマの柱「${item.pillar}」は登録されていません`);
    if (!item.topic.trim()) errors.push(`投稿枠 ${item.slotIndex} のテーマが空です`);
  }
  for (let i = 0; i < slotCount; i++) if (!seen.has(i)) errors.push(`投稿枠 ${i} に計画がありません`);

  // 柱の偏り：1つの柱が「枠数 ÷ 柱の数」（切り上げ）を超えたら偏りとみなす
  if (pillars.length > 1 && slotCount > 1) {
    const limit = Math.ceil(slotCount / Math.min(pillars.length, slotCount));
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.pillar, (counts.get(item.pillar) ?? 0) + 1);
    for (const [pillar, count] of counts) {
      if (count > limit) errors.push(`投稿テーマの柱「${pillar}」が${count}回あり偏っています（${limit}回まで）`);
    }
  }
  return errors;
}
