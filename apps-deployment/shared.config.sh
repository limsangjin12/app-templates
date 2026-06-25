# Shared deploy defaults — source this from each app's `deploy.config.sh`.
#
# Keep only reusable identifiers and local secret paths here. Do not commit
# private keys, service account JSON, Android keystores, or app-specific secrets.
#
# App example:
#
#   APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
#   export APPS_DEPLOY_DIR
#   source "$APPS_DEPLOY_DIR/shared.config.sh"
#
#   export ASC_BUNDLE_ID=com.example.myapp
#   export ASC_APP_NAME="MyApp"
#   export PLAY_PACKAGE_NAME=com.example.myapp

# App Store Connect -----------------------------------------------------------
# .p8 key file convention:
#   $HOME/.appstoreconnect/private_keys/AuthKey_${ASC_API_KEY}.p8
export ASC_API_KEY=${ASC_API_KEY:-}
export ASC_API_ISSUER=${ASC_API_ISSUER:-}
export ASC_TEAM_ID=${ASC_TEAM_ID:-}
export ASC_TEAM_OWNER=${ASC_TEAM_OWNER:-}

# TestFlight defaults ---------------------------------------------------------
# Format: email:First:Last;email:First:Last
export ASC_BETA_GROUP=${ASC_BETA_GROUP:-"Internal"}
export ASC_BETA_INTERNAL=${ASC_BETA_INTERNAL:-true}
export ASC_BETA_TESTERS=${ASC_BETA_TESTERS:-}

# Backward-compatible single tester variables used by older scripts.
export ASC_BETA_TESTER=${ASC_BETA_TESTER:-}
export ASC_TESTER_FIRSTNAME=${ASC_TESTER_FIRSTNAME:-}
export ASC_TESTER_LASTNAME=${ASC_TESTER_LASTNAME:-}

# Google Play -----------------------------------------------------------------
export PLAY_SA_KEY=${PLAY_SA_KEY:-"$HOME/.playconsole/apps-sa.json"}

