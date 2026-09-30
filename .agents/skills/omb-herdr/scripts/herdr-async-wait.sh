#!/usr/bin/env bash
# herdr-async-wait.sh — bounded background poller for one Herdr agent turn.
# Usage: herdr-async-wait.sh <agent-name> <poll-seconds 5..60> <deadline-epoch-seconds>
#
# Always exits 0 and prints KEY=VALUE lines, with exactly one HERDR_ASYNC_STATUS line
# per invocation. Never sends input to the agent, never exits/closes a Pane or tab.
# Callers rely on `agent get` succeeding rather than any specific `agent wait`
# error/timeout code, since that format is not confirmed stable.
#
# Hang bound: every `herdr agent wait`/`herdr agent get` call runs under `run_bounded`,
# a perl `fork`+`alarm`+process-group-kill wrapper, so a wedged herdr binary (or a
# subprocess it spawns) cannot keep this poller alive forever. A plain `alarm; exec`
# only signals the top-level process — a herdr binary that shells out to a helper
# leaves that helper as an orphan holding stdout open, which would hang a `$(...)`
# capture indefinitely. `run_bounded` puts the command in its own process group and
# kills the whole group on timeout. Limitation: a descendant that itself escapes that
# group (e.g. by calling `setsid`/`setpgrp`) is not reached by the group kill and is
# not bounded by this mechanism. As defense in depth against that same escape case,
# `agent wait`'s output is captured through a temp file rather than a pipe: reading a
# regular file never blocks on another process's open write end the way reading a pipe
# does, so an escaped descendant that still holds the file open cannot stall the read.
# `agent wait` is bounded at the iteration's slice plus a fixed grace period; `agent
# get` is bounded at a fixed cap, itself capped so it never runs past the remaining
# deadline plus that same grace. A bound-killed `agent wait` is treated as a
# non-settled slice (the loop continues to the next iteration); a bound-killed or
# otherwise failed `agent get` emits LOST. `perl` is required on PATH for the hang
# bound itself, so its absence is checked first (INVALID perl_unavailable). Argument
# validation runs next, so malformed arguments are reported as INVALID even on a host
# without `herdr` installed. Only once arguments are valid is `herdr` itself checked
# (LOST herdr_unavailable). Every step around the temp file is also failure-safe under
# `set -e`: a failed `mktemp` emits LOST tempfile_unavailable, and a failed read of the
# captured wait output emits LOST output_read_failed — both still exit 0 with exactly
# one status line, same as the output-sanitize failure path (LOST output_sanitize_failed).
set -euo pipefail
agent="${1:-}"; poll="${2:-}"; deadline="${3:-}"; iterations=0

GRACE_S=5
GET_TIMEOUT_S=15

# Only set once the agent argument has passed validation, so an INVALID emit never
# echoes an unvalidated agent argument back to the caller.
emit_agent=""

emit() {
  local status="$1" reason="${2:-}"
  printf 'HERDR_ASYNC_STATUS=%s\nHERDR_ASYNC_AGENT=%s\nHERDR_ASYNC_ITERATIONS=%s\n' "$status" "$emit_agent" "$iterations"
  if [ -n "$reason" ]; then printf 'HERDR_ASYNC_REASON=%s\n' "$reason"; fi
  exit 0
}

# run_bounded <seconds> <cmd> [args...] — runs cmd in its own process group and kills
# that whole group (SIGKILL) if it is still alive after <seconds>. This bounds cmd's
# entire process tree, not just its top-level PID, which a plain `alarm; exec` cannot
# do once cmd forks a subprocess. See the header limitation note for the one case this
# still cannot reach (a descendant that escapes the process group itself).
run_bounded() {
  local bound_s="$1"; shift
  perl -e '
    my $t = shift @ARGV;
    my $pid = fork();
    if (!defined $pid) { exit 1; }
    if ($pid == 0) {
      setpgrp(0, 0);
      exec { $ARGV[0] } @ARGV;
      exit 127;
    }
    setpgrp($pid, $pid);
    local $SIG{ALRM} = sub { kill(-9, $pid); };
    alarm($t);
    waitpid($pid, 0);
    my $status = $?;
    alarm(0);
    exit(($status & 127) ? 128 + ($status & 127) : $status >> 8);
  ' -- "$bound_s" "$@"
}

command -v perl >/dev/null 2>&1 || emit INVALID perl_unavailable

[[ "$agent" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || emit INVALID agent_name
emit_agent="$agent"
[[ "$poll" =~ ^[0-9]{1,3}$ ]] || emit INVALID poll_seconds
poll=$(( 10#$poll ))
(( poll >= 5 && poll <= 60 )) || emit INVALID poll_seconds
[[ "$deadline" =~ ^[0-9]{1,12}$ ]] || emit INVALID deadline
deadline=$(( 10#$deadline ))

command -v herdr >/dev/null 2>&1 || emit LOST herdr_unavailable

if ! wait_out_file=$(mktemp "${TMPDIR:-/tmp}/herdr-async-wait.XXXXXX" 2>/dev/null); then
  emit LOST tempfile_unavailable
fi
trap 'rm -f "$wait_out_file"' EXIT

while :; do
  started=$(date +%s)
  remaining=$(( deadline - started ))
  (( remaining > 0 )) || emit CEILING deadline_reached
  slice=$(( remaining < poll ? remaining : poll )); iterations=$(( iterations + 1 ))
  wait_alarm=$(( slice + GRACE_S ))
  if run_bounded "$wait_alarm" herdr agent wait "$agent" --timeout "$(( slice * 1000 ))" > "$wait_out_file" 2>&1; then
    if ! out=$(cat "$wait_out_file" 2>/dev/null); then
      emit LOST output_read_failed
    fi
    if clean_out=$(LC_ALL=C printf '%s' "$out" | LC_ALL=C tr -d '\r' | LC_ALL=C tr '\n' ' ' | LC_ALL=C tr -d '\000-\010\013\014\016-\037\177'); then
      printf 'HERDR_ASYNC_WAIT=%s\n' "$clean_out"; emit SETTLED
    else
      emit LOST output_sanitize_failed
    fi
  fi
  get_budget=$(( deadline - $(date +%s) + GRACE_S ))
  (( get_budget >= 1 )) || get_budget=1
  get_alarm=$GET_TIMEOUT_S
  (( get_alarm <= get_budget )) || get_alarm=$get_budget
  run_bounded "$get_alarm" herdr agent get "$agent" >/dev/null 2>&1 || emit LOST agent_get_failed
  rest=$(( slice - ($(date +%s) - started) ))
  if (( rest > 0 )); then sleep "$rest"; fi
done
