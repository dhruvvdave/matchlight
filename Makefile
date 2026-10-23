.PHONY: install dev test check build docker up deploy simulate

install:
	npm ci

dev: install          ## API (tsx watch) + Vite dev server -> http://localhost:5173
	npm run dev

test:
	npm test

check:                ## format, lint, typecheck, tests (what CI runs)
	npm run check

build:
	npm run build

docker:               ## one-command local run in a container -> http://localhost:8787
	docker compose up --build

simulate:             ## write a replayable JSONL match stream to data/runs/
	npm run simulate -- late-comeback

deploy:               ## provision + deploy to Azure (Container Apps, Static Web Apps, OpenAI, Web PubSub, Cosmos, ...)
	azd up
