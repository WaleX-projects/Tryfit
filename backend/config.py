import os
from dotenv import load_dotenv

# Absolute path to the .env file in the backend directory
env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path)

# Load environment variables from the .env file
DATABASE_URL = os.getenv("DATABASE_URL","")
DATABASE_URL_alembic = os.getenv("DATABASE_URL_alembic","")
YOUCAM_API_KEY = os.getenv("YOUCAM_API_KEY", "")
YOUCAM_WEBHOOK_SECRET = os.getenv("YOUCAM_WEBHOOK_SECRET", "")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))

# Print the loaded environment variables for debugging purposes
print(DATABASE_URL ,YOUCAM_WEBHOOK_SECRET, HOST)

# Validate that the required environment variables are loaded
if not DATABASE_URL:
    raise ValueError(f"DATABASE_URL could not be loaded from {env_path}")
if not YOUCAM_API_KEY:
    raise ValueError(f"YOUCAM_API_KEY could not be loaded from {env_path}")
if not YOUCAM_WEBHOOK_SECRET:
    raise ValueError(f"YOUCAM_WEBHOOK_SECRET could not be loaded from {env_path}")