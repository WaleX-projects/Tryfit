# Use an official lightweight Python image.
FROM python:3.11-slim

# Set a working directory.
WORKDIR /app

# Install runtime dependencies.
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency declaration and install.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source.
COPY . ./

# Use a non-root user for safety.
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

# Expose the application port.
EXPOSE 8000

# Default command.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
