# Netlify 정적 호스팅

Terraform 없이 정적 앱 페이지를 공개하고 싶을 때 이 옵션을 사용합니다.

## 권장 설정

monorepo 전체에 하나의 Netlify site를 만들거나, 앱마다 별도 site를 만들 수 있습니다.

앱마다 별도 site를 쓰는 경우:

- Netlify의 빌드 명령(`Build command`): 비워둠
- Publish directory(공개 디렉터리): `<category>/<app>/docs`
- Netlify의 운영 브랜치(`Production branch`): `main`

하나의 공유 site를 쓰는 경우:

- Publish directory(공개 디렉터리): `public-site` 같은 생성 폴더
- CI 또는 deploy command(배포 명령)에서 각 `<category>/<app>/docs/*`를 `public-site/<app>/`으로 복사

## 공유 site 배포 명령 예시

```sh
node infra/scripts/build-static-site.mjs --out=public-site
```

그 다음 Netlify publish directory를 `public-site`로 설정합니다.

## 배포 후 작업

최종 Netlify URL을 `infra/scripts/apps-config.mjs`에 반영합니다.

```js
{
  name: 'my-app',
  bundleId: 'com.example.myapp',
  packageName: 'com.example.myapp',
  urls: {
    home: 'https://example.netlify.app/my-app/',
    privacy: 'https://example.netlify.app/my-app/privacy.html',
    terms: null,
    accountDeletion: null,
    support: 'https://example.netlify.app/my-app/',
  },
}
```
