.PHONY: generate-graph run install test

generate-graph:
	venv/Scripts/python scripts/generate_graph_js.py

run:
	venv/Scripts/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload

install:
	pip install -r requirements.txt

test:
	venv/Scripts/pytest tests/
