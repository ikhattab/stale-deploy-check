#!/usr/bin/env bash
# Runs stale-deploy-check for action.yml. Inputs arrive as INPUT_* variables, and results go to
# $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY. Always exits 0, so the cache step after it still runs;
# action.yml fails the job afterwards from the exit-code output.
set -uo pipefail
set -f # check ids and origins are split on whitespace, never globbed

dir="$PWD/.stale-deploy-check"
mkdir -p "$dir"
rm -f "$dir/previous.json" "$dir/report.txt"

args=("$INPUT_URL" --out "$dir/report.json" --no-color)
compared=false
if [[ "$INPUT_BASELINE" != "true" ]]; then
  rm -f "$dir/report.json" # a self-hosted runner can keep one from an earlier job
elif [[ -f "$dir/report.json" ]]; then
  mv "$dir/report.json" "$dir/previous.json"
  args+=(--baseline "$dir/previous.json")
  compared=true
  echo "Comparing with the previous run's report."
else
  echo "No earlier report in the cache, so this run can't check for deleted files. The next run will compare with this one."
fi
for origin in $INPUT_ASSET_ORIGINS; do args+=(--asset-origin "$origin"); done
for id in $INPUT_IGNORE; do args+=(--ignore "$id"); done
[[ "$INPUT_STRICT" == "true" ]] && args+=(--strict)

if [[ -n "$INPUT_COMMAND" ]]; then
  read -ra cli <<< "$INPUT_COMMAND"
  cli_dir=$PWD
else
  cli=(npx -y "stale-deploy-check@$INPUT_VERSION")
  # Outside the workspace: there, npx would run a stale-deploy-check the project has installed
  # instead of the version this action pins.
  cli_dir=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
fi

echo "Running stale-deploy-check $(cd "$cli_dir" && "${cli[@]}" --version 2>&1)"
(cd "$cli_dir" && "${cli[@]}" "${args[@]}") 2>&1 | tee "$dir/report.txt"
code=${PIPESTATUS[0]}

{
  echo "exit-code=$code"
  echo "compared=$compared"
  # Relative, like the cache step's path in action.yml.
  [[ -f "$dir/report.json" ]] && echo "report=.stale-deploy-check/report.json"
} >> "${GITHUB_OUTPUT:-/dev/null}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Stale deploy check"
    echo
    echo '```'
    cat "$dir/report.txt"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
