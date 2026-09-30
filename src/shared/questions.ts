// The fixed Question set (CONTEXT.md). Aimed at AI engineers; English for Tier A.
export type Question = { id: string; text: string };

export const QUESTIONS: Question[] = [
  { id: "shipped-system", text: "Walk me through an AI system you shipped to real users. What was your part in it?" },
  { id: "production-failure", text: "Tell me about a time a model or agent you worked on failed in production. What happened, and what did you do?" },
  { id: "why-this-role", text: "Why this role, and why now?" },
];

export function findQuestion(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
