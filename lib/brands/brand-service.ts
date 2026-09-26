import { prisma } from "@/lib/database/prisma";
import { notFound } from "@/lib/errors/service-error";
import type { BrandInput } from "@/lib/validation/schemas";

export async function listBrands(userId: string) {
  return prisma.brand.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
}

export async function createBrand(userId: string, input: BrandInput) {
  return prisma.brand.create({ data: { userId, ...input } });
}

export async function updateBrand(userId: string, brandId: string, input: BrandInput) {
  const { count } = await prisma.brand.updateMany({ where: { id: brandId, userId }, data: input });
  if (count === 0) throw notFound("ブランド");
  return prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
}

export async function deleteBrand(userId: string, brandId: string) {
  const { count } = await prisma.brand.deleteMany({ where: { id: brandId, userId } });
  if (count === 0) throw notFound("ブランド");
}
