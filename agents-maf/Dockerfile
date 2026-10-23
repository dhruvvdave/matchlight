FROM mcr.microsoft.com/devcontainers/python:3.12
WORKDIR /app
COPY pyproject.toml ./
COPY matchlight_maf ./matchlight_maf
RUN pip install --no-cache-dir .
ENV PORT=8790
EXPOSE 8790
CMD ["python", "-m", "matchlight_maf.server"]
