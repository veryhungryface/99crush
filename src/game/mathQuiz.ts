export interface MultiplicationQuestion {
  left: number;
  right: number;
  answer: number;
  choices: [number, number];
}

const FACTOR_MIN = 2;
const FACTOR_MAX = 9;
const DISTRACTOR_MAX_DISTANCE = 4;

const unit = (random: () => number) => Math.max(0, Math.min(0.999999, random()));

const randomInt = (random: () => number, min: number, max: number) =>
  min + Math.floor(unit(random) * (max - min + 1));

const createCloseDistractor = (answer: number, random: () => number) => {
  const distance = randomInt(random, 1, DISTRACTOR_MAX_DISTANCE);
  const direction = unit(random) < 0.5 ? -1 : 1;
  const candidate = answer + direction * distance;
  return candidate > 0 && candidate !== answer ? candidate : answer + distance;
};

export const createMultiplicationQuestion = (random: () => number = Math.random): MultiplicationQuestion => {
  const left = randomInt(random, FACTOR_MIN, FACTOR_MAX);
  const right = randomInt(random, FACTOR_MIN, FACTOR_MAX);
  const answer = left * right;
  const distractor = createCloseDistractor(answer, random);
  const choices: [number, number] = unit(random) < 0.5 ? [answer, distractor] : [distractor, answer];

  return {
    left,
    right,
    answer,
    choices
  };
};
