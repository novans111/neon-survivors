FROM python:3.12-slim

WORKDIR /app
COPY server.py /app/server.py
COPY static /app/static

EXPOSE 8080
ENV PORT=8080

CMD ["python3", "server.py"]
