# Setup: OpenAI-Compatible LLM Provider

Jarvis uses an OpenAI-compatible API for the dreaming engine — extracting decisions, patterns, and preferences from conversation transcripts, and for semantic memory search via embeddings.

## Requirements

Any provider that exposes an **OpenAI-compatible API** (`/v1/chat/completions` and `/v1/embeddings`):

- **Azure OpenAI** — Recommended for production
- **OpenAI** — Direct API access
- **Local models** — Ollama, vLLM, LM Studio, or any OpenAI-compatible server

You need two model capabilities:
- **Chat model** (GPT-4o, GPT-5.x, or equivalent) — for dream extraction and consolidation
- **Embedding model** (text-embedding-3-large or equivalent) — for semantic memory search via MemU

## Environment Variables

Regardless of provider, you configure 5 variables in your `.env`:

```bash
LLM_API_KEY=your-api-key
LLM_ENDPOINT=https://your-provider-endpoint/
LLM_MODEL=model-name
LLM_BASE_URL=https://your-provider-endpoint/v1/
LLM_EMBEDDING_BASE_URL=https://your-provider-endpoint/v1/
```

> **Note:** The variable names contain "AZURE" for historical reasons but work with any OpenAI-compatible provider.

## Provider-Specific Setup

### Azure OpenAI

1. Create an Azure OpenAI resource in the [Azure Portal](https://portal.azure.com)
2. Deploy a chat model (e.g., `gpt-4o`) and an embedding model (e.g., `text-embedding-3-large`)
3. Get your API key from **Keys and Endpoint**

```bash
LLM_API_KEY=your-azure-key
LLM_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
LLM_MODEL=gpt-4o
LLM_BASE_URL=https://your-resource.cognitiveservices.azure.com/openai/v1/
LLM_EMBEDDING_BASE_URL=https://your-resource.cognitiveservices.azure.com/openai/v1/
```

### OpenAI (Direct)

```bash
LLM_API_KEY=sk-your-openai-key
LLM_ENDPOINT=https://api.openai.com/
LLM_MODEL=gpt-4o
LLM_BASE_URL=https://api.openai.com/v1/
LLM_EMBEDDING_BASE_URL=https://api.openai.com/v1/
```

### Local Models (Ollama)

```bash
LLM_API_KEY=not-needed
LLM_ENDPOINT=http://localhost:11434/
LLM_MODEL=llama3
LLM_BASE_URL=http://localhost:11434/v1/
LLM_EMBEDDING_BASE_URL=http://localhost:11434/v1/
```

### Local Models (vLLM / LM Studio)

```bash
LLM_API_KEY=not-needed
LLM_ENDPOINT=http://localhost:8080/
LLM_MODEL=your-model-name
LLM_BASE_URL=http://localhost:8080/v1/
LLM_EMBEDDING_BASE_URL=http://localhost:8080/v1/
```

## Verification

Test that your provider responds to the OpenAI chat completions API:

```bash
curl -s "${LLM_BASE_URL}chat/completions" \
  -H "Authorization: Bearer ${LLM_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"'${LLM_MODEL}'","messages":[{"role":"user","content":"Hello"}],"max_tokens":5}'
```

A successful response with a `choices` array means your provider is ready.
