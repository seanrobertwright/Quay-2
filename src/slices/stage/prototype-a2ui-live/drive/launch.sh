#!/bin/bash
# Launches this branch's Quay with its own profile and CDP port, and prints its Windows PID.
export LOCALAPPDATA='C:\scratch\q711\la'
export WEBVIEW2_USER_DATA_FOLDER='C:\scratch\q711\wv'
for v in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | grep -iE '^(CLAUDE|ANTHROPIC|CODEX_|QUAY|GIT_CONFIG_|GIT_EDITOR|AI_AGENT|WEBVIEW2_)'); do
  [ "$v" = WEBVIEW2_USER_DATA_FOLDER ] || unset "$v"
done
export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=${CDP_PORT:-19711}"
export QUAY_A2UI_PROTO_LOG='C:\scratch\q711\out\quay.log'
export A2UI711_WAIT_S=${A2UI711_WAIT_S:-100}
cd /c/scratch/q711/scratch711
EXE=${QUAY_EXE:-/c/scratch/quay-worktree/src-tauri/target/release/tauri-app.exe}
"$EXE" > /c/scratch/q711/out/stdout.log 2>&1 &
echo "winpid $(cat /proc/$!/winpid)" | tee /c/scratch/q711/out/pid.txt
wait
