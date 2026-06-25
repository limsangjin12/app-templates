# AWS 정적 호스팅

이 옵션은 모든 앱의 정적 페이지를 하나의 S3 website bucket에 올리고 Terraform으로 관리합니다.

Terraform으로 인프라를 관리하려는 경우에만 AWS를 선택합니다. Netlify나 Vercel을 선택했다면 이 디렉터리는 사용하지 않습니다.

## 설정

`infra/aws/`에 로컬 전용 `terraform.tfvars`를 만듭니다.

```hcl
aws_region  = "ap-northeast-2"
aws_profile = "default"
bucket_name = "your-unique-app-pages-bucket"
project     = "apps-web"
```

HCP Terraform을 사용한다면 `terraform.tf`의 `cloud` block 주석을 해제하고 organization/workspace를 프로젝트에 맞게 수정합니다.

## 앱 페이지 추가

`main.tf`의 `local.pages`에 항목을 추가합니다.

```hcl
"my-app/index.html" = {
  source       = "${path.module}/../../games/my-app/docs/index.html"
  content_type = "text/html; charset=utf-8"
}
"my-app/privacy.html" = {
  source       = "${path.module}/../../games/my-app/docs/privacy.html"
  content_type = "text/html; charset=utf-8"
}
```

그 다음 실행합니다.

```sh
cd infra/aws
terraform init
terraform apply
```

apply 후 나온 공개 URL을 `infra/scripts/apps-config.mjs`에 반영합니다.

