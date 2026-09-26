import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/logging/logger";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        const ok = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
        if (!user || !ok) {
          logger.warn("auth.login.failed", { email: parsed.data.email });
          return null;
        }
        logger.info("auth.login.success", { userId: user.id });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
