import { NextResponse } from "next/server";
import { Effect } from "effect";
import { adminRpc } from "../../rpc";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await Effect.runPromise(
    adminRpc((rpc) => rpc.getOperationsSnapshot()),
  );

  return NextResponse.json(snapshot, {
    headers: {
      "cache-control": "no-store",
    },
  });
}
