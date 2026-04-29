"use server";

import { auth } from "@clerk/nextjs/server";
import { createSafeActionClient } from "next-safe-action";

export const actionClient = createSafeActionClient({
  handleServerError(error) {
    return error instanceof Error ? error.message : "Unexpected server error";
  },
}).use(async ({ next }) => {
  const session = await auth();

  if (!session.userId) {
    throw new Error("Unauthorized admin action");
  }

  return next({
    ctx: {
      userId: session.userId,
      orgId: session.orgId ?? null,
    },
  });
});
