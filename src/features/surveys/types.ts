export type QuestionType = "rating" | "nps" | "choice" | "text";
export type Question = { id: string; type: QuestionType; label: string; options?: string[]; required?: boolean };
export type SurveyInput = { title: string; intro: string; audience: "participants" | "anyone"; status: "draft" | "open" | "closed"; questions: Question[] };

export const TEMPLATE_QUESTIONS: Question[] = [
  { id: "overall", type: "rating", label: "How would you rate the event overall?", required: true },
  { id: "recommend", type: "nps", label: "How likely are you to recommend this event to a friend?", required: true },
  { id: "liked", type: "text", label: "What did you like most?" },
  { id: "improve", type: "text", label: "What should we improve next time?" },
];

export type QuestionResult = Question & {
  result: { count: number; average?: number | null; nps?: number | null; distribution?: Record<string, number>; answers?: string[] };
};
export type SurveyResults = { responses: number; questions: QuestionResult[] };
