from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Database ──
    db_host: str = "postgres"
    db_port: int = 5432
    db_user: str = "jarvis"
    db_password: str
    db_name: str = "jarvis"

    # ── Redis ──
    redis_url: str = "redis://redis:6379/0"

    # ── LLM (OpenAI-compatible) ──
    llm_api_key: str = ""
    llm_endpoint: str = ""
    llm_model: str = ""
    llm_base_url: str = ""
    llm_embedding_base_url: str = ""
    llm_embedding_model: str = "text-embedding-3-large"

    # ── Jarvis Server ──
    jarvis_api_key: str
    jarvis_log_level: str = "INFO"
    jarvis_memory_path: str = "/app/ai-memory"
    jarvis_github_pat: str = ""

    # ── MemU ──
    memu_base_url: str = "http://memu-server:8000"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    # Backward-compatible aliases
    @property
    def ai_memory_repo_path(self) -> str:
        return self.jarvis_memory_path

    @property
    def azure_openai_api_key(self) -> str:
        return self.llm_api_key

    @property
    def azure_openai_endpoint(self) -> str:
        return self.llm_endpoint

    @property
    def azure_openai_deployment(self) -> str:
        return self.llm_model


settings = Settings()
