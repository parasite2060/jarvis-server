from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # PostgreSQL
    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_user: str = "jarvis"
    postgres_password: str
    postgres_db: str = "jarvis"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Azure OpenAI
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_deployment: str = ""

    # ai-memory repo path
    ai_memory_repo_path: str = "/app/ai-memory"

    # Server
    jarvis_api_key: str
    jarvis_log_level: str = "INFO"

    # MemU
    memu_base_url: str = "http://memu-server:8000"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
