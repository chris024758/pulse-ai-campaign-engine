import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load environment variables from .env
load_dotenv()

class FivetranSettings(BaseSettings):
    api_key: str
    api_secret: str
    group_id: str
    base_url: str = "https://api.fivetran.com/v1"
    service_account: str
    model_config = SettingsConfigDict(env_prefix="FIVETRAN_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

class GoogleCloudSettings(BaseSettings):
    project: str
    application_credentials: str = ""
    model_config = SettingsConfigDict(env_prefix="GOOGLE_CLOUD_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

class BigQuerySettings(BaseSettings):
    dataset: str = "pulse_mall_data"
    location: str = "US"
    region: str = "us-central1"
    model_config = SettingsConfigDict(env_prefix="BIGQUERY_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

class GeminiSettings(BaseSettings):
    api_key: str = ""
    pro_model: str = "gemini-2.5-pro"
    flash_model: str = "gemini-2.5-flash"
    imagen_model: str = "imagen-3.0-generate-002"
    model_config = SettingsConfigDict(env_prefix="GEMINI_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

class MallSettings(BaseSettings):
    name: str = "Galleria Dallas"
    lat: float = 32.8537
    lng: float = -96.7731
    timezone: str = "America/Chicago"
    mall_id: str = "galleria_dallas"
    model_config = SettingsConfigDict(env_prefix="MALL_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

class AppSettings(BaseSettings):
    environment: str = "development"
    cloud_run_url: str = "http://localhost:8080"
    webhook_secret: str = "pulse_webhook_secret"
    mock_pos_url: str = "http://localhost:5001"
    mock_pos_port: int = 5001
    api_port: int = 8080
    features: dict = {}
    firebase_project_id: str = ""
    firebase_service_account_path: str = ""
    demo_mode: bool = True
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

class FeatureSettings(BaseSettings):
    google_weather_api_key: str = ""
    model_config = SettingsConfigDict(env_prefix="FEATURE_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

class Settings(BaseSettings):
    fivetran: FivetranSettings = FivetranSettings()
    google_cloud: GoogleCloudSettings = GoogleCloudSettings()
    bigquery: BigQuerySettings = BigQuerySettings()
    gemini: GeminiSettings = GeminiSettings()
    mall: MallSettings = MallSettings()
    app: AppSettings = AppSettings()
    features: FeatureSettings = FeatureSettings()
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()

# Validation check
critical_fields = {
    "FIVETRAN_API_KEY": settings.fivetran.api_key,
    "FIVETRAN_API_SECRET": settings.fivetran.api_secret,
    "FIVETRAN_GROUP_ID": settings.fivetran.group_id,
    "FIVETRAN_SERVICE_ACCOUNT": settings.fivetran.service_account,
    "GOOGLE_CLOUD_PROJECT": settings.google_cloud.project,
}

for env_var, value in critical_fields.items():
    if not value or value.strip() == "":
        print(f"WARNING: Critical environment variable {env_var} is empty or not configured.")
