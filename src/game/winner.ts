export type ScoreEntry<PlayerId extends string = string> = {
  playerId: PlayerId;
  score: number;
};

export const getWinningPlayerIds = <PlayerId extends string>(
  entries: ReadonlyArray<ScoreEntry<PlayerId>>
) => {
  if (entries.length === 0) return new Set<PlayerId>();
  const highScore = Math.max(...entries.map((entry) => entry.score));
  return new Set(entries.filter((entry) => entry.score === highScore).map((entry) => entry.playerId));
};
