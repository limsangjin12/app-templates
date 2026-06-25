# Vercel 정적 호스팅

Vercel preview 배포가 필요하거나 정적 페이지가 이후 frontend app으로 커질 가능성이 있을 때 이 옵션을 사용합니다.

## 권장 설정

앱마다 별도 Vercel project를 쓰는 경우:

- Vercel의 프레임워크 preset(`Framework preset`): Other
- Vercel의 빌드 명령(`Build command`): 비워둠
- Vercel의 출력 디렉터리(`Output directory`): `<category>/<app>/docs`

하나의 공유 Vercel project를 쓰는 경우:

- `public-site` 같은 생성 output directory(출력 디렉터리)를 사용
- 각 `<category>/<app>/docs/*`를 `public-site/<app>/`으로 복사
- Vercel의 출력 디렉터리(`Output directory`)를 `public-site`로 설정

## 공유 build command(빌드 명령) 예시

```sh
node infra/scripts/build-static-site.mjs --out=public-site
```

## 배포 후 작업

최종 Vercel URL을 `infra/scripts/apps-config.mjs`에 반영합니다.

```js
{
  name: 'my-app',
  bundleId: 'com.example.myapp',
  packageName: 'com.example.myapp',
  urls: {
    home: 'https://example.vercel.app/my-app/',
    privacy: 'https://example.vercel.app/my-app/privacy.html',
    terms: null,
    accountDeletion: null,
    support: 'https://example.vercel.app/my-app/',
  },
}
```
