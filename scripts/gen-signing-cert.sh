#!/usr/bin/env bash
#
# gen-signing-cert.sh — generate a STABLE self-signed code-signing certificate
# for metacodex's macOS builds (Option B: no Apple Developer Program).
#
# Why: an ad-hoc signed app gets a new code identity (cdhash) on every build,
# so macOS TCC re-asks for every permission after each auto-update. Signing
# with the SAME self-signed cert on every release gives a stable "designated
# requirement" (identifier + leaf certificate), so TCC recognizes the updated
# app as the same app and keeps the permissions you already granted.
#
# This does NOT notarize. Gatekeeper will still show the "unidentified
# developer" warning on first install (the `xattr -cr` step stays). Only an
# Apple Developer ID + notarization removes that.
#
# Run ONCE. Re-running with --force regenerates the cert, which RESETS every
# permission grant (new leaf certificate => new designated requirement). Keep
# the generated .p12 safe; it is the only copy of the signing key.
#
# Output goes to ~/.metacodex-signing/ (outside the repo — never committed).
# After running, follow the printed `gh secret set` commands.

set -euo pipefail

IDENTITY_CN="metacodex self-signed"
OUT_DIR="${HOME}/.metacodex-signing"
P12_PATH="${OUT_DIR}/metacodex-signing.p12"
B64_PATH="${OUT_DIR}/APPLE_CERTIFICATE.b64"
PWD_PATH="${OUT_DIR}/APPLE_CERTIFICATE_PASSWORD.txt"
CN_PATH="${OUT_DIR}/APPLE_SIGNING_IDENTITY.txt"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

if [[ -f "${P12_PATH}" && "${FORCE}" -ne 1 ]]; then
  echo "A signing cert already exists at:"
  echo "  ${P12_PATH}"
  echo
  echo "Re-running would REGENERATE it and reset every permission grant on every"
  echo "user's machine. If that's really what you want, pass --force."
  exit 1
fi

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Random, shell-safe password (hex only) — no trailing newline in the secret file.
CERT_PWD="$(openssl rand -hex 24)"

cat > "${WORK}/codesign.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions    = ext
prompt             = no
[ dn ]
CN = ${IDENTITY_CN}
[ ext ]
basicConstraints   = critical, CA:FALSE
keyUsage           = critical, digitalSignature
extendedKeyUsage   = critical, codeSigning
EOF

# 10-year self-signed cert with the codeSigning EKU that `codesign` requires.
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "${WORK}/codesign.key" \
  -out    "${WORK}/codesign.crt" \
  -config "${WORK}/codesign.cnf" >/dev/null 2>&1

# Legacy PKCS#12 encryption so the GitHub macOS runner's `security import`
# (older OpenSSL/SecurityFramework) can read it without "unsupported" errors.
openssl pkcs12 -export -legacy \
  -inkey "${WORK}/codesign.key" \
  -in    "${WORK}/codesign.crt" \
  -name  "${IDENTITY_CN}" \
  -out   "${P12_PATH}" \
  -passout "pass:${CERT_PWD}" >/dev/null 2>&1

chmod 600 "${P12_PATH}"

# Single-line base64 (no wrapping) for the GitHub secret.
openssl base64 -A -in "${P12_PATH}" -out "${B64_PATH}"
printf '%s' "${CERT_PWD}" > "${PWD_PATH}"
printf '%s' "${IDENTITY_CN}" > "${CN_PATH}"
chmod 600 "${B64_PATH}" "${PWD_PATH}" "${CN_PATH}"

echo "Done. Signing material written to ${OUT_DIR}:"
echo "  - metacodex-signing.p12          (the signing key — BACK THIS UP, keep it secret)"
echo "  - APPLE_CERTIFICATE.b64          (base64 of the .p12, for the GitHub secret)"
echo "  - APPLE_CERTIFICATE_PASSWORD.txt (the .p12 password)"
echo "  - APPLE_SIGNING_IDENTITY.txt     (the identity name: ${IDENTITY_CN})"
echo
echo "Next, push the two secrets to GitHub (the identity name is set in the workflow, not a secret):"
echo
echo "  gh secret set APPLE_CERTIFICATE          --repo victorbenazzi/metacodex < \"${B64_PATH}\""
echo "  gh secret set APPLE_CERTIFICATE_PASSWORD --repo victorbenazzi/metacodex < \"${PWD_PATH}\""
echo
echo "Then cut a release — the workflow will sign the .app with this cert."
