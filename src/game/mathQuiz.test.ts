import { describe, expect, it } from "vitest";
import { createMultiplicationQuestion } from "./mathQuiz";

const sequence = (values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
};

describe("createMultiplicationQuestion", () => {
  it("creates a two-choice multiplication question", () => {
    const question = createMultiplicationQuestion(sequence([0, 0.25, 0.4, 0.8, 0.3]));

    expect(question.left).toBeGreaterThanOrEqual(2);
    expect(question.left).toBeLessThanOrEqual(9);
    expect(question.right).toBeGreaterThanOrEqual(2);
    expect(question.right).toBeLessThanOrEqual(9);
    expect(question.answer).toBe(question.left * question.right);
    expect(question.choices).toHaveLength(2);
    expect(question.choices).toContain(question.answer);
  });

  it("keeps the wrong choice close to the correct answer", () => {
    const question = createMultiplicationQuestion(sequence([0.9, 0.9, 0.99, 0, 0.99]));
    const wrong = question.choices.find((choice) => choice !== question.answer);

    expect(wrong).toBeDefined();
    expect(Math.abs((wrong ?? 0) - question.answer)).toBeGreaterThanOrEqual(1);
    expect(Math.abs((wrong ?? 0) - question.answer)).toBeLessThanOrEqual(4);
  });
});
