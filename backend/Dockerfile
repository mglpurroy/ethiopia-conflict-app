FROM python:3.11-slim

WORKDIR /app

# System deps for geopandas (GDAL), shapely (GEOS), pyproj (PROJ), rasterio
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    gdal-bin \
    libgeos-dev \
    libproj-dev \
    libspatialindex-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

RUN mkdir -p /app/cache

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Single worker on Render free tier; increase on paid plans
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
