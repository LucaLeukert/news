# Local AI Runner Runbook

1. Start an OpenAI-compatible local model server, for example Ollama at `http://localhost:11434/v1` or LM Studio at `http://localhost:1234/v1`.
2. Set `AI_HOST_PROFILE=local`, `AI_MODEL_POLICY_PROFILE=local_test`, `AI_HOST_LOCAL_BASE_URL`, and the API/service token variables.
3. Run `bun --filter @news/ai-runner dev`.
4. Confirm the runner leases one job at a time or a small batch.
5. Confirm posted results include model version, prompt version, input artifact IDs, schema version, confidence, validation status, and latency.

The cloud API must never require inbound access to the local machine.

The runner uses AI SDK `createOpenAICompatible` through the `AiGateway` Effect
service, so changing from LM Studio to another local OpenAI-compatible runtime
only requires env/config changes.
