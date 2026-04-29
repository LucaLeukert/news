import type { createDb } from "./index";
import { aiJobEvents } from "./schema";

type Db = ReturnType<typeof createDb>;

export type AiJobEventInput = {
  readonly jobId: string;
  readonly attemptNumber?: number;
  readonly level?: "info" | "warn" | "error";
  readonly eventType: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly createdAt?: Date;
};

const toInsert = (input: AiJobEventInput): typeof aiJobEvents.$inferInsert => ({
  jobId: input.jobId,
  attemptNumber: input.attemptNumber ?? 0,
  level: input.level ?? "info",
  eventType: input.eventType,
  message: input.message,
  details: input.details ?? {},
  createdAt: input.createdAt,
});

export const appendAiJobEvent = (db: Db, input: AiJobEventInput) =>
  db
    .insert(aiJobEvents)
    .values(toInsert(input))
    .then(() => undefined);

export const appendAiJobEvents = (
  db: Db,
  inputs: ReadonlyArray<AiJobEventInput>,
) =>
  inputs.length === 0
    ? Promise.resolve()
    : db
        .insert(aiJobEvents)
        .values(inputs.map(toInsert))
        .then(() => undefined);
