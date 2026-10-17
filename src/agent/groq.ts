import Groq from "groq-sdk";

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
export const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
export const REFLECT_MODEL = process.env.GROQ_REFLECT_MODEL ?? "llama-3.1-8b-instant";

export async function complete(system: string, user: string, model = MODEL, json = false): Promise<string> {
  const r = await groq.chat.completions.create({
    model, temperature: 0.1,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(json ? { response_format: { type: "json_object" as const } } : {}),
  });
  return r.choices[0]?.message?.content ?? "";
}
