#!/bin/sh
# Rootful Podman deployment helper for the contest/pilot image.
# It intentionally needs only standard Rocky Linux tools plus Podman; Node,
# git, Docker, Docker Compose, and a host Caddy binary are not required.
set -eu

PROGRAM=${0##*/}
CONTAINER_NAME=smartfarm-cloud-pilot
DATA_VOLUME=smartfarm_cloud_pilot_data
CADDY_DATA_VOLUME=smartfarm_cloud_pilot_caddy_data
CADDY_CONFIG_VOLUME=smartfarm_cloud_pilot_caddy_config
DEFAULT_IMAGE=smartfarm-os-cloud-pilot:pilot
MAX_ARCHIVE_BYTES=536870912
temporary_directory=
normalized_env_file=

usage() {
  cat <<USAGE
Usage:
  $PROGRAM build --archive SOURCE.tar.gz --archive-sha256 SHA256 --commit GIT_SHA [--image IMAGE]
  $PROGRAM up --env PILOT.env [--image IMAGE]
  $PROGRAM down
  $PROGRAM logs [--follow] [--tail COUNT]
  $PROGRAM status

The build source must be a public-release tar or tar.gz archive with the
repository's deploy/cloud-pilot/Dockerfile inside its single top-level folder.
--commit is an operator claim recorded on the image. --archive-sha256 pins the
actual source bytes that are built.
USAGE
}

fail() {
  printf '%s\n' "[smartfarm-cloud-pilot] $1" >&2
  exit 1
}

cleanup() {
  if [ -n "$temporary_directory" ] && [ -d "$temporary_directory" ]; then
    rm -rf "$temporary_directory"
  fi
}

trap cleanup EXIT HUP INT TERM

require_rootful_podman() {
  if ! command -v podman >/dev/null 2>&1; then
    fail "Podman is required. Install/use rootful Podman 4.9.4 on Rocky Linux 8.10."
  fi

  rootless=$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null) \
    || fail "Podman is unavailable or the current user cannot access its service."
  if [ "$rootless" != "false" ]; then
    fail "This pilot requires rootful Podman. Run it through the rootful Podman service."
  fi
}

require_tar() {
  command -v tar >/dev/null 2>&1 \
    || fail "tar is required to unpack the public source archive."
}

require_sha256sum() {
  command -v sha256sum >/dev/null 2>&1 \
    || fail "sha256sum is required to verify the public source archive."
}

require_safe_image_name() {
  case "$1" in
    ""|*[!A-Za-z0-9._/:@-]*) fail "Image names may contain only letters, digits, ., _, /, :, @, and -." ;;
  esac
}

require_commit() {
  case "$1" in
    ???????* ) ;;
    * ) fail "--commit must be a Git commit SHA with at least 7 characters." ;;
  esac
  case "$1" in
    *[!0-9A-Fa-f]* ) fail "--commit must contain only hexadecimal Git SHA characters." ;;
  esac
}

require_sha256() {
  case "$1" in
    ???????????????????????????????????????????????????????????????? ) ;;
    * ) fail "--archive-sha256 must be a 64-character SHA-256 hex digest." ;;
  esac
  case "$1" in
    *[!0-9a-f]* ) fail "--archive-sha256 must be a lowercase 64-character SHA-256 hex digest." ;;
  esac
}

prepare_temp_directory() {
  temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/smartfarm-cloud-pilot.XXXXXX") \
    || fail "Unable to create a private temporary directory."
  chmod 700 "$temporary_directory" || fail "Unable to protect the temporary directory."
}

extract_build_context() {
  archive=$1
  expected_archive_sha256=$2
  [ -f "$archive" ] && [ -r "$archive" ] \
    || fail "The source archive does not exist or cannot be read."

  case "$archive" in
    -*) fail "Source archive paths must not begin with a dash." ;;
    *.tar|*.tar.gz|*.tgz) ;;
    *) fail "Source archive must be .tar, .tar.gz, or .tgz." ;;
  esac

  set -- $(wc -c < "$archive")
  archive_bytes=$1
  case "$archive_bytes" in
    ""|*[!0-9]*) fail "Unable to determine the source archive size." ;;
  esac
  if [ "$archive_bytes" -gt "$MAX_ARCHIVE_BYTES" ]; then
    fail "Source archive exceeds the 512 MiB pilot build limit."
  fi

  actual_archive_sha256=$(sha256sum "$archive" | awk '{print $1}') \
    || fail "Unable to calculate the source archive SHA-256 digest."
  if [ "$actual_archive_sha256" != "$expected_archive_sha256" ]; then
    fail "Source archive SHA-256 does not match --archive-sha256."
  fi

  source_directory="$temporary_directory/source"
  mkdir "$source_directory" || fail "Unable to create the source extraction directory."
  if ! tar -tvf "$archive" | awk '
    { kind = substr($0, 1, 1); if (kind != "-" && kind != "d") invalid = 1 }
    END { exit invalid }
  '; then
    fail "Source archive may contain only regular files and directories."
  fi
  if ! tar -tf "$archive" | awk '
    BEGIN { top = ""; invalid = 0 }
    {
      entry = $0
      if (entry ~ /^\/|(^|\/)\.\.($|\/)/) {
        invalid = 1
        next
      }
      sub(/^\.\//, "", entry)
      if (entry == "") next
      split(entry, parts, "/")
      if (top == "") top = parts[1]
      else if (top != parts[1]) invalid = 1
    }
    END { exit (invalid || top == "") }
  '; then
    fail "Source archive must be readable, path-safe, and have one top-level directory."
  fi
  tar -xf "$archive" -C "$source_directory" --no-same-owner --no-same-permissions \
    || fail "Unable to safely extract the source archive."

  set -- "$source_directory"/*
  [ "$#" -eq 1 ] && [ -d "$1" ] \
    || fail "Source archive must contain exactly one top-level repository directory."
  [ -f "$1/deploy/cloud-pilot/Dockerfile" ] \
    || fail "Source archive does not contain deploy/cloud-pilot/Dockerfile."
  printf '%s\n' "$1"
}

normalize_env_file() {
  input_env=$1
  [ -f "$input_env" ] && [ -r "$input_env" ] \
    || fail "The pilot env file does not exist or cannot be read."

  normalized_env_file="$temporary_directory/pilot.env"
  : > "$normalized_env_file" || fail "Unable to create the private Podman env file."
  chmod 600 "$normalized_env_file" || fail "Unable to protect the temporary Podman env file."

  seen_site_address=0
  seen_basic_user=0
  seen_basic_hash=0
  seen_demo_key=0
  seen_weather_key=0

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    case "$raw_line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) fail "The pilot env file contains an invalid line." ;;
    esac

    key=${raw_line%%=*}
    value=${raw_line#*=}
    case "$key" in
      SMARTFARM_SITE_ADDRESS)
        [ "$seen_site_address" -eq 0 ] || fail "The pilot env file repeats a variable name."
        seen_site_address=1
        ;;
      SMARTFARM_BASIC_AUTH_USER)
        [ "$seen_basic_user" -eq 0 ] || fail "The pilot env file repeats a variable name."
        seen_basic_user=1
        ;;
      SMARTFARM_BASIC_AUTH_HASH)
        [ "$seen_basic_hash" -eq 0 ] || fail "The pilot env file repeats a variable name."
        seen_basic_hash=1
        ;;
      SMARTFARM_DEMO_KEY)
        [ "$seen_demo_key" -eq 0 ] || fail "The pilot env file repeats a variable name."
        seen_demo_key=1
        ;;
      SMARTFARM_OPENWEATHER_API_KEY)
        [ "$seen_weather_key" -eq 0 ] || fail "The pilot env file repeats a variable name."
        seen_weather_key=1
        ;;
      *) fail "The pilot env file contains an unsupported variable name." ;;
    esac

    if [ -n "$value" ]; then
      first_character=${value%"${value#?}"}
      last_character=${value#"${value%?}"}
      if [ "$first_character" = "'" ] && [ "$last_character" = "'" ]; then
        value=${value#\'}
        value=${value%\'}
      elif [ "$first_character" = "'" ] || [ "$last_character" = "'" ]; then
        fail "The pilot env file has an unmatched single quote."
      fi
    fi
    printf '%s=%s\n' "$key" "$value" >> "$normalized_env_file" \
      || fail "Unable to normalize the pilot env file."
  done < "$input_env"

  [ "$seen_site_address" -eq 1 ] \
    && [ "$seen_basic_user" -eq 1 ] \
    && [ "$seen_basic_hash" -eq 1 ] \
    && [ "$seen_demo_key" -eq 1 ] \
    || fail "The pilot env file is missing a required variable."

  # The weather key is deliberately allowed to be blank for fixture mode.
  [ "$seen_weather_key" -eq 1 ] || printf '%s\n' "SMARTFARM_OPENWEATHER_API_KEY=" >> "$normalized_env_file"

  if ! awk -F= '
    $1 == "SMARTFARM_SITE_ADDRESS" && $2 ~ /^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$/ && $2 ~ /\./ && $2 !~ /\.\./ { site = 1 }
    $1 == "SMARTFARM_BASIC_AUTH_USER" && $2 ~ /^[A-Za-z0-9][A-Za-z0-9._@-]*$/ { user = 1 }
    $1 == "SMARTFARM_BASIC_AUTH_HASH" && $2 !~ /[[:space:]]/ && length($2) > 0 { hash = 1 }
    $1 == "SMARTFARM_DEMO_KEY" && $2 ~ /^[A-Za-z0-9_-]+$/ { key = 1 }
    $1 == "SMARTFARM_OPENWEATHER_API_KEY" && $2 !~ /[[:space:]]/ { weather = 1 }
    END { exit !(site && user && hash && key && weather) }
  ' "$normalized_env_file"; then
    fail "Pilot values are empty or contain unsupported whitespace or characters."
  fi
}

container_exists() {
  podman container exists -- "$CONTAINER_NAME"
}

require_managed_container() {
  managed=$(podman inspect --format '{{index .Config.Labels "io.smartfarm.cloud-pilot.managed"}}' -- "$CONTAINER_NAME" 2>/dev/null) \
    || fail "Unable to inspect the pilot container ownership label."
  [ "$managed" = "true" ] \
    || fail "Refusing to manage a container not created by this SmartFarmOS pilot helper."
}

create_volume_if_missing() {
  volume=$1
  if ! podman volume exists -- "$volume"; then
    podman volume create -- "$volume" >/dev/null \
      || fail "Unable to create the required Podman volume."
  fi
}

build_image() {
  archive=
  archive_sha256=
  commit=
  image=$DEFAULT_IMAGE

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --archive) [ "$#" -ge 2 ] || fail "--archive needs a value."; archive=$2; shift 2 ;;
      --archive-sha256) [ "$#" -ge 2 ] || fail "--archive-sha256 needs a value."; archive_sha256=$2; shift 2 ;;
      --commit) [ "$#" -ge 2 ] || fail "--commit needs a value."; commit=$2; shift 2 ;;
      --image) [ "$#" -ge 2 ] || fail "--image needs a value."; image=$2; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) fail "Unknown build option. Run $PROGRAM build --help." ;;
    esac
  done

  [ -n "$archive" ] || fail "build requires --archive."
  [ -n "$archive_sha256" ] || fail "build requires --archive-sha256."
  [ -n "$commit" ] || fail "build requires --commit."
  require_sha256 "$archive_sha256"
  require_commit "$commit"
  require_safe_image_name "$image"
  require_rootful_podman
  require_tar
  require_sha256sum
  prepare_temp_directory
  context_directory=$(extract_build_context "$archive" "$archive_sha256")

  podman build \
    --file "$context_directory/deploy/cloud-pilot/Dockerfile" \
    --tag "$image" \
    --label "org.opencontainers.image.revision=$commit" \
    --label "io.smartfarm.cloud-pilot.archive-sha256=$archive_sha256" \
    --label "org.opencontainers.image.title=SmartFarmOS-cloud-pilot" \
    "$context_directory"
}

up_container() {
  input_env=
  image=$DEFAULT_IMAGE

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --env) [ "$#" -ge 2 ] || fail "--env needs a value."; input_env=$2; shift 2 ;;
      --image) [ "$#" -ge 2 ] || fail "--image needs a value."; image=$2; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) fail "Unknown up option. Run $PROGRAM up --help." ;;
    esac
  done

  [ -n "$input_env" ] || fail "up requires --env."
  require_safe_image_name "$image"
  require_rootful_podman
  if container_exists; then
    fail "Container $CONTAINER_NAME already exists; inspect it or run '$PROGRAM down' yourself before starting a replacement."
  fi
  podman image exists -- "$image" \
    || fail "Image $image is not present. Build it first with '$PROGRAM build'."

  prepare_temp_directory
  normalize_env_file "$input_env"
  create_volume_if_missing "$DATA_VOLUME"
  create_volume_if_missing "$CADDY_DATA_VOLUME"
  create_volume_if_missing "$CADDY_CONFIG_VOLUME"

  podman run --detach \
    --name "$CONTAINER_NAME" \
    --label io.smartfarm.cloud-pilot.managed=true \
    --init \
    --restart unless-stopped \
    --env SMARTFARM_DEMO_MODE=1 \
    --env SMARTFARM_DEMO_PORT=3100 \
    --env SMARTFARM_PWA_PORT=4173 \
    --env SMARTFARM_DEMO_DB_PATH=/data/smartfarm-demo.sqlite \
    --env XDG_DATA_HOME=/srv/caddy-data \
    --env XDG_CONFIG_HOME=/srv/caddy-config \
    --env-file "$normalized_env_file" \
    --publish 80:80 \
    --publish 443:443 \
    --volume "$DATA_VOLUME:/data:Z" \
    --volume "$CADDY_DATA_VOLUME:/srv/caddy-data:Z" \
    --volume "$CADDY_CONFIG_VOLUME:/srv/caddy-config:Z" \
    --health-cmd "node -e \"fetch('http://127.0.0.1:3100/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))\"" \
    --health-interval 30s \
    --health-timeout 5s \
    --health-retries 5 \
    --health-start-period 20s \
    -- "$image" >/dev/null \
    || fail "Podman could not start the pilot container. Run '$PROGRAM logs' after resolving the reported error."

  printf '%s\n' "[smartfarm-cloud-pilot] started $CONTAINER_NAME; only host ports 80 and 443 are published."
}

down_container() {
  require_rootful_podman
  if ! container_exists; then
    printf '%s\n' "[smartfarm-cloud-pilot] no pilot container exists."
    return
  fi
  require_managed_container

  podman stop --time 30 -- "$CONTAINER_NAME" >/dev/null \
    || fail "Unable to stop the pilot container."
  podman rm -- "$CONTAINER_NAME" >/dev/null \
    || fail "Unable to remove the stopped pilot container."
  printf '%s\n' "[smartfarm-cloud-pilot] stopped the pilot container; named SQLite and Caddy volumes were preserved."
}

show_logs() {
  require_rootful_podman
  follow=
  tail=200
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --follow|-f) follow=1; shift ;;
      --tail) [ "$#" -ge 2 ] || fail "--tail needs a value."; tail=$2; shift 2 ;;
      --help|-h) usage; exit 0 ;;
      *) fail "Unknown logs option. Run $PROGRAM logs --help." ;;
    esac
  done
  case "$tail" in *[!0-9]*|"") fail "--tail must be a non-negative integer." ;; esac
  container_exists || fail "Container $CONTAINER_NAME does not exist."
  if [ -n "$follow" ]; then
    exec podman logs --follow --tail "$tail" -- "$CONTAINER_NAME"
  fi
  exec podman logs --tail "$tail" -- "$CONTAINER_NAME"
}

show_status() {
  require_rootful_podman
  container_exists || fail "Container $CONTAINER_NAME does not exist."
  state=$(podman inspect --format '{{.State.Status}}' -- "$CONTAINER_NAME") \
    || fail "Unable to inspect the pilot container state."
  health=$(podman inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' -- "$CONTAINER_NAME" 2>/dev/null) \
    || health=unknown
  revision=$(podman inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' -- "$CONTAINER_NAME" 2>/dev/null) \
    || revision=unknown
  [ -n "$health" ] || health=unknown
  [ -n "$revision" ] || revision=unknown
  printf '%s\n' "container=$CONTAINER_NAME state=$state health=$health revision=$revision"
}

[ "$#" -ge 1 ] || { usage; exit 1; }
command_name=$1
shift
case "$command_name" in
  build) build_image "$@" ;;
  up) up_container "$@" ;;
  down) [ "$#" -eq 0 ] || fail "down does not accept options."; down_container ;;
  logs) show_logs "$@" ;;
  status) [ "$#" -eq 0 ] || fail "status does not accept options."; show_status ;;
  --help|-h|help) usage ;;
  *) fail "Unknown command. Run $PROGRAM --help." ;;
esac
