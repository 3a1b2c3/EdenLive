#!/usr/bin/env bash
# Copy the shared first-person kit into every game that uses it (games stay self-contained).
set -e
cd "$(dirname "$0")/.."
for g in ember-den iron-colossus jade-duel warehouse-sokoban; do
  [ -d "$g" ] || continue
  mkdir -p "$g/lib"
  for f in _shared/*.mjs; do cp "$f" "$g/lib/$(basename "$f")"; done
done
