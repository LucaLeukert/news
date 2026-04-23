# Local AI Runner Runbook

1. Start an OpenAI-compatible local model server for `gpt-oss-20b`, for example LM Studio at `http://localhost:1234/v1`.
2. Set `LOCAL_MODEL_BASE_URL`, `LOCAL_MODEL_NAME`, `API_BASE_URL`, and Cloudflare Access service token variables.
3. Run `bun --filter @news/ai-runner dev`.
4. Confirm the runner leases one job at a time or a small batch.
5. Confirm posted results include model version, prompt version, input artifact IDs, schema version, confidence, validation status, and latency.

The cloud API must never require inbound access to the local machine.

The runner uses AI SDK `createOpenAICompatible` through the `AiGateway` Effect
service, so changing from LM Studio to another local OpenAI-compatible runtime
only requires env/config changes.
