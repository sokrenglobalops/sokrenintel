#!/bin/zsh
# Checks an OpenSky API client ID + secret from this Mac. Values are read hidden and never printed or saved.
# Usage: ./test/opensky_login_check.sh                 (asks for the values, hidden)
#        ./test/opensky_login_check.sh FILE.json       (reads OpenSky's downloaded credentials file)
if [[ -n "$1" ]]; then
  [[ -r "$1" ]] || { print "can't read $1"; exit 1; }
  ID=$(grep -o '"clientId" *: *"[^"]*"' "$1" | sed 's/.*: *"//; s/"$//')
  SECRET=$(grep -o '"clientSecret" *: *"[^"]*"' "$1" | sed 's/.*: *"//; s/"$//')
  print "Testing credentials from $1"
else
  print -n "OpenSky client ID (ends in -api-client): "; read -rs ID; print
  print -n "OpenSky client secret: "; read -rs SECRET; print
fi
ID="${ID//[[:space:]]/}"; SECRET="${SECRET//[[:space:]]/}"
[[ "$ID" == *-api-client ]] && print "ID format: ok (ends in -api-client)" || print "ID format: does NOT end in -api-client"
print "ID length: ${#ID}   secret length: ${#SECRET}"
OUT=$(curl -s -m 20 -w '\n%{http_code}' -X POST \
  https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token \
  --data-urlencode grant_type=client_credentials --data-urlencode "client_id=$ID" --data-urlencode "client_secret=$SECRET")
CODE="${OUT##*$'\n'}"
if [[ "$CODE" == 200 ]]; then print "RESULT: OpenSky ACCEPTED these credentials."; else print "RESULT: OpenSky REJECTED them (HTTP $CODE): $(print -r -- "${OUT%$'\n'*}" | grep -o '"error_description":"[^"]*"')"; fi
unset ID SECRET OUT
