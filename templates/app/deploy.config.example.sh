APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export PLAY_PACKAGE_NAME="com.example.myapp"

# 반복 배포에 필요한 공개 식별자는 여기에 둡니다.
# private key, service account JSON, keystore 본문은 repo에 넣지 않습니다.
#
# export ASC_API_KEY="<KEY_ID>"
# export ASC_API_ISSUER="<ISSUER_ID>"
# export ASC_TEAM_ID="<TEAM_ID>"
# export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"

