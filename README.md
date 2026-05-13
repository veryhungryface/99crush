# 99크러시

별도 폴더로 분리한 Phaser + TypeScript 매치3 퍼즐 프로토타입입니다.

## 실행

```bash
npm install
npm run dev
```

## 구현된 규칙

- 인접 타일 스왑
- 3개 이상 매치 시 제거
- 4개 매치 시 로켓 생성
- 5개 매치 시 레인보우 오브 생성
- 교차 매치 시 폭탄 생성
- 중력 낙하와 새 타일 리필
- 연쇄 콤보 점수 가산
- 스페셜 타일 연쇄 폭발
- 가능한 수가 없으면 자동 셔플

## 구조

- `src/game/Match3Engine.ts`: 프레임워크와 분리된 순수 게임 룰
- `src/scenes/GameScene.ts`: Phaser 입력, 애니메이션, 파티클, 카메라 연출
- `src/scenes/assets.ts`: 생성 이미지에서 추출한 스프라이트/아이템/UI 에셋 로딩
- `public/assets/generated/`: 이번 대화에서 생성한 콘셉트/에셋 원본 백업
- `public/assets/sprites/characters/`: 캐릭터 6종 x 6프레임 스프라이트
- `public/assets/sprites/items/`: 아이템/FX 스프라이트
- `public/assets/ui/`: 생성한 배경, 보드 프레임, 하단 HUD 프레임
