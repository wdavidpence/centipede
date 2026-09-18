#!/bin/bash
cd "$(dirname "$0")"
for i in 1 2 3 4 5; do
  out=$(node verify-browser.js 2>&1 | grep "BROWSER VERIFY:")
  echo "run $i: $out"
  if ! echo "$out" | grep -q "0 failed"; then echo "GATE FAILED at run $i"; exit 1; fi
done
echo "GATE: 5/5 green"
