HistoGraphPublic Node CLI
==========================

Contents
--------
- cli/ : Compiled JavaScript bundle (TypeScript source lives in /node).
- sources.sample.json : Example CC0-friendly source list to get you started.

Requirements
------------
- Node.js 18.17+ (needed to run the bundled CLI)
- Network access to your master API (default http://localhost:8000)

Quick Start
-----------
1. Extract this folder somewhere safe (e.g. ~/histograph-node).
2. Copy the sample sources file so you can edit it:
   cp sources.sample.json sources.json
3. Run the CLI:
   node cli/index.js run --sources sources.json --loop

Common Flags
------------
--master-url <url>      Point to a remote master API
--node-id <uuid>        Provide a stable identifier for this machine
--fetch-remote-sources  Pull the /sources list from the master instead of local JSON
--dry-run               Print payloads without submitting to /master/ingest

Need help? Email simon@luminarylabs.dev
