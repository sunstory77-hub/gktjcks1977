from pydantic_settings import BaseSettings
from functools import lru_cache
import os

class Settings(BaseSettings):
    # API Configuration
    OPENAI_API_KEY: str

    # Server Configuration
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # Image Generation Settings
    IMAGE_WIDTH: int = 1024
    IMAGE_HEIGHT: int = 1024
    MAX_RETRIES: int = 3
    TIMEOUT_SECONDS: int = 30

    # Storage
    STATIC_DIR: str = "static/generated"
    MAX_STORED_IMAGES: int = 100  # Cleanup old images

    class Config:
        env_file = ".env"
        case_sensitive = True

@lru_cache()
def get_settings():
    return Settings()

settings = get_settings()
