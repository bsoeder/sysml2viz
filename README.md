# SysML2 Visualizer

This project provides a lightweight Python-served HTML page that renders:

- `OV-1` operational concept view
- `BDD` block definition diagram
- `IBD` internal block diagram
- Activity diagram
- Sequence diagram
- Corpus similarity analysis
- Simulation-readiness grading derived from the SENTINEL Generate-Simulate-Verify paper

It only accepts a constrained SysML2-style textual specification through the page. You can paste the spec or load a local `.sysml` / `.txt` file and re-render the diagrams without changing the Python server.

Supported textual constructs:

- `package Name { ... }`
- `doc "Description"`
- `part def Name { ... }`
- `item def Name { ... }`
- `attribute name : Type;`
- `operation name();`
- `port name;`
- `part name : Type;`
- `connect source.port -> target.port "label";`
- `flow source -> target "label";`
- `action def Name { ... }` with `start`, `action`, `decision`, `end`, and `flow`

## Run

```bash
python3 app.py
```

Then open `http://127.0.0.1:8000`.

## Batch Scoring

Generate the corpus similarity CSV:

```bash
node scripts/score_model_similarity.js
```

Generate the simulation-readiness CSV:

```bash
node scripts/score_simulation_readiness.js
```

The batch readiness scorer grades each `data/**/*.sysml` model for SENTINEL-style `L1` structural readiness, `L2` executable behavior, `L3` property-verification readiness, trace observability, and repairability.
