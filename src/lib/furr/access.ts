import { createMiddleware } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/**
 * authMiddleware + FurrBox whitelist: signed-in users who are neither Discord staff nor on the
 * whitelist are rejected. Use it on every FurrBox server function except `getMe` (which the
 * "no access" screen needs).
 */
export const accessMiddleware = createMiddleware({ type: "function" })
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    const { requireAccess } = await import("./core");
    await requireAccess(context.userId, context.bearerToken);
    return next();
  });
